import { timingSafeEqual } from "node:crypto";
import {
  CreateDataSourceRequestSchema,
  CreateRegisteredQueryRequestSchema,
  ExecuteQueryRequestSchema,
  RenameDataSourceRequestSchema,
  UpdateDataSourceRequestSchema,
} from "@mda/contracts";
import { Value } from "@sinclair/typebox/value";
import { SQL } from "bun";
import { loadDataSourceConfig } from "./config.ts";
import type { JdbcConnectorConfig } from "./jdbc-connector.ts";
import {
  activateSource,
  createSource,
  DataAccessError,
  describeSource,
  executeQuery,
  getQuery,
  getSource,
  listQueries,
  listSources,
  refreshSchema,
  registerQuery,
  renameSource,
  testSource,
  transitionSource,
  updateSource,
} from "./store.ts";

type Schema = Parameters<typeof Value.Check>[0];

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function body<T>(request: Request, schema: Schema): Promise<T> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new DataAccessError(400, "VALIDATION_ERROR", "JSON body required");
  }
  if (!Value.Check(schema, value)) {
    throw new DataAccessError(400, "VALIDATION_ERROR", "Request is invalid");
  }
  return value as T;
}

function context(request: Request, token: string) {
  const authorization = request.headers.get("authorization") ?? "";
  if (
    !authorization.startsWith("Bearer ") ||
    !safeEqual(authorization.slice(7), token)
  ) {
    throw new DataAccessError(401, "UNAUTHENTICATED", "Invalid internal token");
  }
  const tenantId = request.headers.get("x-mda-tenant") ?? "";
  const actorId = request.headers.get("x-mda-actor") ?? "";
  if (!tenantId || !actorId || tenantId.length > 200 || actorId.length > 200) {
    throw new DataAccessError(
      400,
      "VALIDATION_ERROR",
      "Trusted context required",
    );
  }
  return {
    tenantId,
    actorId,
    requestId: request.headers.get("x-request-id") ?? crypto.randomUUID(),
  };
}

function errorResponse(error: unknown, requestId: string): Response {
  if (error instanceof DataAccessError) {
    return Response.json(
      {
        code: error.code,
        message: error.message,
        requestId,
        retryable: error.retryable,
      },
      { status: error.status },
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  const separator = message.indexOf(":");
  const code = separator > 0 ? message.slice(0, separator) : "INTERNAL_ERROR";
  const safeMessage =
    separator > 0
      ? message.slice(separator + 1).trim()
      : "Data Source operation failed";
  const status = [
    "PARAMETER_INVALID",
    "QUERY_INVALID",
    "CONFIG_INVALID",
  ].includes(code)
    ? 400
    : code === "HTTP_DESTINATION_BLOCKED"
      ? 403
      : 502;
  return Response.json(
    {
      code,
      message: safeMessage.slice(0, 2_000),
      requestId,
      retryable: status >= 500,
    },
    { status },
  );
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new DataAccessError(400, "VALIDATION_ERROR", "Invalid resource ID");
  }
}

export function startDataSourceServer(
  db: SQL,
  internalToken: string,
  jdbc: JdbcConnectorConfig,
  port: number,
  hostname: string,
) {
  return Bun.serve({
    port,
    hostname,
    routes: {
      "/health/live": () =>
        Response.json({
          service: "mda-datasource",
          status: "ok",
          version: "0.1.0",
        }),
      "/health/ready": async () => {
        try {
          await db`SELECT 1`;
          return Response.json({
            service: "mda-datasource",
            status: "ok",
            version: "0.1.0",
          });
        } catch {
          return Response.json(
            {
              code: "SERVICE_UNAVAILABLE",
              message: "Data Source Service is not ready",
              requestId: crypto.randomUUID(),
              retryable: true,
            },
            { status: 503 },
          );
        }
      },
    },
    async fetch(request) {
      const requestId =
        request.headers.get("x-request-id") ?? crypto.randomUUID();
      try {
        const principal = context(request, internalToken);
        const url = new URL(request.url);
        const sourceCollection = url.pathname === "/internal/v1/data-sources";
        const sourceMatch = url.pathname.match(
          /^\/internal\/v1\/data-sources\/([^/]+)(?:\/(description|rename|update|test|activate|enable|disable|delete|restore|schema-refresh))?$/,
        );
        const queryCollection = url.pathname === "/internal/v1/queries";
        const queryMatch = url.pathname.match(
          /^\/internal\/v1\/queries\/([^/]+)(?:\/(execute))?$/,
        );

        if (sourceCollection && request.method === "GET") {
          const limit = Number(url.searchParams.get("limit") ?? "100");
          if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
            throw new DataAccessError(400, "VALIDATION_ERROR", "Invalid limit");
          }
          return Response.json({
            items: await listSources(db, principal.tenantId, limit),
          });
        }
        if (sourceCollection && request.method === "POST") {
          const result = await createSource(
            db,
            principal.tenantId,
            principal.actorId,
            principal.requestId,
            request.headers.get("idempotency-key") ?? crypto.randomUUID(),
            await body(request, CreateDataSourceRequestSchema),
          );
          return Response.json(result.source, {
            status: result.created ? 201 : 200,
          });
        }
        if (sourceMatch) {
          const id = decode(sourceMatch[1] ?? "");
          const action = sourceMatch[2];
          if (!action && request.method === "GET") {
            const source = await getSource(db, principal.tenantId, id);
            if (!source)
              throw new DataAccessError(
                404,
                "DATA_SOURCE_NOT_FOUND",
                "Data Source not found",
              );
            return Response.json(source);
          }
          if (action === "description" && request.method === "GET") {
            return Response.json(
              await describeSource(db, principal.tenantId, id),
            );
          }
          if (action === "rename" && request.method === "POST") {
            return Response.json(
              await renameSource(
                db,
                principal.tenantId,
                principal.actorId,
                principal.requestId,
                id,
                await body(request, RenameDataSourceRequestSchema),
              ),
            );
          }
          if (action === "update" && request.method === "POST") {
            return Response.json(
              await updateSource(
                db,
                principal.tenantId,
                principal.actorId,
                principal.requestId,
                id,
                await body(request, UpdateDataSourceRequestSchema),
              ),
            );
          }
          if (action === "test" && request.method === "POST") {
            return Response.json(
              await testSource(
                db,
                jdbc,
                principal.tenantId,
                principal.actorId,
                principal.requestId,
                id,
              ),
            );
          }
          if (action === "activate" && request.method === "POST") {
            return Response.json(
              await activateSource(
                db,
                principal.tenantId,
                principal.actorId,
                principal.requestId,
                id,
              ),
            );
          }
          if (
            ["enable", "disable", "delete", "restore"].includes(action ?? "") &&
            request.method === "POST"
          ) {
            return Response.json(
              await transitionSource(
                db,
                principal.tenantId,
                principal.actorId,
                principal.requestId,
                id,
                action as "enable" | "disable" | "delete" | "restore",
              ),
            );
          }
          if (action === "schema-refresh" && request.method === "POST") {
            return Response.json(
              await refreshSchema(
                db,
                principal.tenantId,
                principal.actorId,
                principal.requestId,
                id,
              ),
            );
          }
        }

        if (queryCollection && request.method === "GET") {
          return Response.json({
            items: await listQueries(
              db,
              principal.tenantId,
              url.searchParams.get("sourceId") ?? undefined,
            ),
          });
        }
        if (queryCollection && request.method === "POST") {
          const result = await registerQuery(
            db,
            jdbc,
            principal.tenantId,
            principal.actorId,
            principal.requestId,
            request.headers.get("idempotency-key") ?? crypto.randomUUID(),
            await body(request, CreateRegisteredQueryRequestSchema),
          );
          return Response.json(result.query, {
            status: result.created ? 201 : 200,
          });
        }
        if (queryMatch) {
          const id = decode(queryMatch[1] ?? "");
          if (!queryMatch[2] && request.method === "GET") {
            const query = await getQuery(db, principal.tenantId, id);
            if (!query)
              throw new DataAccessError(
                404,
                "QUERY_NOT_FOUND",
                "Query not found",
              );
            return Response.json(query);
          }
          if (queryMatch[2] === "execute" && request.method === "POST") {
            const publicExecution =
              request.headers.get("x-mda-public-execution") === "true";
            return Response.json(
              await executeQuery(
                db,
                jdbc,
                principal.tenantId,
                principal.actorId,
                id,
                await body(request, ExecuteQueryRequestSchema),
                publicExecution,
              ),
            );
          }
        }
        throw new DataAccessError(404, "NOT_FOUND", "Route not found");
      } catch (error) {
        return errorResponse(error, requestId);
      }
    },
  });
}

if (import.meta.main) {
  const config = loadDataSourceConfig();
  const db = new SQL(config.databaseUrl);
  const server = startDataSourceServer(
    db,
    config.internalToken,
    {
      runnerUrl: config.jdbcRunnerUrl,
      runnerToken: config.jdbcRunnerToken,
      secretsRoot: config.secretsRoot,
    },
    config.port,
    config.hostname,
  );
  console.log(
    JSON.stringify({ event: "data-source.started", url: server.url.href }),
  );
}
