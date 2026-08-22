import {
  type AgentLeaseCommand,
  AgentLeaseCommandSchema,
  type CreateRegisteredQueryRequest,
  CreateRegisteredQueryRequestSchema,
  type ExecuteQueryRequest,
  ExecuteQueryRequestSchema,
} from "@mda/contracts";
import { Type } from "@sinclair/typebox";
import type { SQL } from "bun";
import type { DataSourceClient } from "../../adapters/data-source-client.ts";
import { authorizeInternalRequest } from "../../shared/auth.ts";
import { errorResponse, HttpError, readJson } from "../../shared/http.ts";
import { authorizeAgentJobLease } from "../agent-work/postgres.ts";

const DescribeSchema = Type.Object(
  {
    ...AgentLeaseCommandSchema.properties,
    sourceId: Type.String({ minLength: 1, maxLength: 200 }),
  },
  { additionalProperties: false },
);

const ListQuerySchema = Type.Object(
  {
    ...AgentLeaseCommandSchema.properties,
    sourceId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  },
  { additionalProperties: false },
);

const RegisterQuerySchema = Type.Object(
  {
    ...AgentLeaseCommandSchema.properties,
    request: CreateRegisteredQueryRequestSchema,
    idempotencyKey: Type.String({ minLength: 1, maxLength: 200 }),
  },
  { additionalProperties: false },
);

const ExecuteSchema = Type.Object(
  {
    ...AgentLeaseCommandSchema.properties,
    queryId: Type.String({ minLength: 1, maxLength: 200 }),
    request: ExecuteQueryRequestSchema,
  },
  { additionalProperties: false },
);

interface AgentDataRouteDependencies {
  db: SQL;
  internalAgentToken?: string;
  dataSources?: DataSourceClient;
}

export async function handleAgentDataRequest(
  request: Request,
  dependencies: AgentDataRouteDependencies,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const match = url.pathname.match(
    /^\/internal\/v1\/agent-jobs\/([^/]+)\/(data-sources|describe-source|queries|register-query|execute-query)$/,
  );
  if (!match) return undefined;
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    if (!dependencies.internalAgentToken || !dependencies.dataSources) {
      throw new HttpError(
        503,
        "DATA_SOURCE_UNAVAILABLE",
        "Data Source Service is unavailable",
        true,
      );
    }
    authorizeInternalRequest(request, dependencies.internalAgentToken);
    if (request.method !== "POST") {
      throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
    }
    const jobId = decodeURIComponent(match[1] ?? "");
    const action = match[2];
    const schema =
      action === "describe-source"
        ? DescribeSchema
        : action === "queries"
          ? ListQuerySchema
          : action === "register-query"
            ? RegisterQuerySchema
            : action === "execute-query"
              ? ExecuteSchema
              : AgentLeaseCommandSchema;
    const input = (await readJson(request, schema)) as AgentLeaseCommand & {
      sourceId?: string;
      queryId?: string;
      request?: CreateRegisteredQueryRequest | ExecuteQueryRequest;
      idempotencyKey?: string;
    };
    const principal = await authorizeAgentJobLease(
      dependencies.db,
      jobId,
      input,
    );
    if (action === "data-sources") {
      return Response.json(await dependencies.dataSources.list(principal));
    }
    if (action === "describe-source") {
      return Response.json(
        await dependencies.dataSources.describe(
          principal,
          input.sourceId as string,
        ),
      );
    }
    if (action === "queries") {
      const response = await dependencies.dataSources.request(
        `/internal/v1/queries${input.sourceId ? `?sourceId=${encodeURIComponent(input.sourceId)}` : ""}`,
        principal,
      );
      return new Response(response.body, {
        status: response.status,
        headers: { "content-type": "application/json" },
      });
    }
    if (action === "register-query") {
      const response = await dependencies.dataSources.request(
        "/internal/v1/queries",
        principal,
        {
          method: "POST",
          headers: { "idempotency-key": input.idempotencyKey as string },
          body: JSON.stringify(input.request as CreateRegisteredQueryRequest),
        },
      );
      return new Response(response.body, {
        status: response.status,
        headers: { "content-type": "application/json" },
      });
    }
    return Response.json(
      await dependencies.dataSources.execute(
        principal,
        input.queryId as string,
        input.request as ExecuteQueryRequest,
      ),
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
