import {
  CreateDashboardFolderRequestSchema,
  type DashboardFolderListResponse,
  DeleteDashboardFolderRequestSchema,
  UpdateDashboardFolderRequestSchema,
} from "@mda/contracts";
import type { SQL } from "bun";
import { type PrincipalContext, requirePermission } from "../../shared/auth.ts";
import {
  errorResponse,
  HttpError,
  readJson,
  requireIdempotencyKey,
} from "../../shared/http.ts";
import {
  createDashboardFolder,
  deleteDashboardFolder,
  listDashboardFolders,
  updateDashboardFolder,
} from "./postgres.ts";

interface DashboardFolderRouteDependencies {
  db: SQL;
  authenticate(request: Request): Promise<PrincipalContext>;
}

function decodeId(value: string): string {
  try {
    const id = decodeURIComponent(value);
    if (!id) throw new Error("empty");
    return id;
  } catch {
    throw new HttpError(400, "VALIDATION_ERROR", "Invalid Dashboard Folder ID");
  }
}

export async function handleDashboardFolderRequest(
  request: Request,
  dependencies: DashboardFolderRouteDependencies,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const collection = url.pathname === "/api/dashboard-folders";
  const item = url.pathname.match(/^\/api\/dashboard-folders\/([^/]+)$/);
  if (!collection && !item) return undefined;

  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const principal = await dependencies.authenticate(request);
    if (collection && request.method === "GET") {
      requirePermission(principal, "dashboard.read");
      const response: DashboardFolderListResponse = {
        items: await listDashboardFolders(dependencies.db, principal.tenantId),
      };
      return Response.json(response);
    }
    if (collection && request.method === "POST") {
      requirePermission(principal, "dashboard.create");
      const result = await createDashboardFolder(
        dependencies.db,
        await readJson(request, CreateDashboardFolderRequestSchema),
        principal,
        requireIdempotencyKey(request),
        requestId,
      );
      return Response.json(result.folder, {
        status: result.created ? 201 : 200,
      });
    }
    if (item && request.method === "PATCH") {
      requirePermission(principal, "dashboard.edit");
      return Response.json(
        await updateDashboardFolder(
          dependencies.db,
          principal.tenantId,
          principal.userId,
          requestId,
          decodeId(item[1] ?? ""),
          await readJson(request, UpdateDashboardFolderRequestSchema),
        ),
      );
    }
    if (item && request.method === "DELETE") {
      requirePermission(principal, "dashboard.edit");
      await deleteDashboardFolder(
        dependencies.db,
        principal.tenantId,
        principal.userId,
        requestId,
        decodeId(item[1] ?? ""),
        await readJson(request, DeleteDashboardFolderRequestSchema),
      );
      return new Response(null, { status: 204 });
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
