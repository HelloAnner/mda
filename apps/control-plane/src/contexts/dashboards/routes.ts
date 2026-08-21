import {
  CreateDashboardRequestSchema,
  type DashboardListResponse,
} from "@mda/contracts";
import type { SQL } from "bun";
import { type PrincipalContext, requirePermission } from "../../shared/auth.ts";
import {
  errorResponse,
  HttpError,
  readJson,
  requireIdempotencyKey,
} from "../../shared/http.ts";
import { getDashboard, insertDashboard, listDashboards } from "./postgres.ts";

interface DashboardRouteDependencies {
  db: SQL;
  authenticate(request: Request): Promise<PrincipalContext>;
}

export async function handleDashboardRequest(
  request: Request,
  dependencies: DashboardRouteDependencies,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (
    url.pathname !== "/api/dashboards" &&
    !url.pathname.startsWith("/api/dashboards/")
  ) {
    return undefined;
  }
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

  try {
    const principal = await dependencies.authenticate(request);

    if (url.pathname === "/api/dashboards" && request.method === "POST") {
      requirePermission(principal, "dashboard.create");
      const idempotencyKey = requireIdempotencyKey(request);
      const body = await readJson(request, CreateDashboardRequestSchema);

      const result = await insertDashboard(
        dependencies.db,
        body,
        principal,
        idempotencyKey,
        requestId,
      );
      return Response.json(result.dashboard, {
        status: result.created ? 201 : 200,
      });
    }

    if (url.pathname === "/api/dashboards" && request.method === "GET") {
      requirePermission(principal, "dashboard.read");
      const rawLimit = url.searchParams.get("limit") ?? "50";
      const limit = Number(rawLimit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new HttpError(
          400,
          "VALIDATION_ERROR",
          "limit must be an integer between 1 and 100",
        );
      }
      const response: DashboardListResponse = {
        items: await listDashboards(dependencies.db, principal.tenantId, limit),
      };
      return Response.json(response);
    }

    const encodedId = url.pathname.slice("/api/dashboards/".length);
    if (encodedId && !encodedId.includes("/") && request.method === "GET") {
      requirePermission(principal, "dashboard.read");
      let id: string;
      try {
        id = decodeURIComponent(encodedId);
      } catch {
        throw new HttpError(400, "VALIDATION_ERROR", "Invalid Dashboard ID");
      }
      const dashboard = await getDashboard(
        dependencies.db,
        principal.tenantId,
        id,
      );
      if (!dashboard) {
        throw new HttpError(404, "DASHBOARD_NOT_FOUND", "Dashboard not found");
      }
      return Response.json(dashboard);
    }

    throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
  } catch (error) {
    if (!(error instanceof HttpError)) {
      console.error(
        JSON.stringify({ event: "request.failed", error: String(error) }),
      );
    }
    return errorResponse(error, requestId);
  }
}
