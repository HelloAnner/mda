import type { DataSourceClient } from "../../adapters/data-source-client.ts";
import { type PrincipalContext, requirePermission } from "../../shared/auth.ts";
import { errorResponse, HttpError } from "../../shared/http.ts";

interface DataAccessRouteDependencies {
  authenticate(request: Request): Promise<PrincipalContext>;
  dataSources?: DataSourceClient;
}

function internalPath(pathname: string): string | undefined {
  if (pathname === "/api/data-sources") return "/internal/v1/data-sources";
  if (pathname.startsWith("/api/data-sources/")) {
    return `/internal/v1/data-sources/${pathname.slice("/api/data-sources/".length)}`;
  }
  if (pathname === "/api/queries") return "/internal/v1/queries";
  if (pathname.startsWith("/api/queries/")) {
    return `/internal/v1/queries/${pathname.slice("/api/queries/".length)}`;
  }
  return undefined;
}

export async function handleDataAccessRequest(
  request: Request,
  dependencies: DataAccessRouteDependencies,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const path = internalPath(url.pathname);
  if (!path) return undefined;
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    if (!dependencies.dataSources) {
      throw new HttpError(
        503,
        "DATA_SOURCE_UNAVAILABLE",
        "Data Source Service is not configured",
        true,
      );
    }
    const principal = await dependencies.authenticate(request);
    requirePermission(
      principal,
      request.method === "GET" ? "dashboard.read" : "dashboard.edit",
    );
    const target = `${path}${url.search}`;
    const headers = new Headers({ "x-request-id": requestId });
    const idempotencyKey = request.headers.get("idempotency-key");
    if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
    const response = await dependencies.dataSources.request(target, principal, {
      method: request.method,
      headers,
      ...(request.method === "GET" || request.method === "HEAD"
        ? {}
        : { body: await request.text() }),
    });
    return new Response(response.body, {
      status: response.status,
      headers: {
        "content-type":
          response.headers.get("content-type") ?? "application/json",
      },
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
