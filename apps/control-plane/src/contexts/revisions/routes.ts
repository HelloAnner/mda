import {
  CreateDashboardRevisionRequestSchema,
  type DashboardRevision,
  type DashboardRevisionFileListResponse,
  type DashboardRevisionListResponse,
} from "@mda/contracts";
import type { SQL } from "bun";
import type { ArtifactStore } from "../../shared/artifacts.ts";
import { type PrincipalContext, requirePermission } from "../../shared/auth.ts";
import {
  errorResponse,
  HttpError,
  readJson,
  requireIdempotencyKey,
} from "../../shared/http.ts";
import { getDashboard } from "../dashboards/postgres.ts";
import {
  createDashboardRevision,
  getDashboardRevision,
  listDashboardRevisions,
  type RevisionRecord,
} from "./postgres.ts";
import { loadRevisionSnapshot } from "./service.ts";
import {
  createSourceTarGzip,
  revisionFiles,
  validateSourcePath,
} from "./snapshot.ts";

interface RevisionRouteDependencies {
  db: SQL;
  artifacts?: ArtifactStore;
  authenticate(request: Request): Promise<PrincipalContext>;
}

function decode(value: string, label: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new HttpError(400, "VALIDATION_ERROR", `Invalid ${label}`);
  }
}

function publicRevision(revision: RevisionRecord): DashboardRevision {
  return {
    id: revision.id,
    dashboardId: revision.dashboardId,
    number: revision.number,
    digest: revision.digest,
    fileCount: revision.fileCount,
    totalBytes: revision.totalBytes,
    ...(revision.message ? { message: revision.message } : {}),
    createdAt: revision.createdAt,
  };
}

function requireArtifacts(
  dependencies: RevisionRouteDependencies,
): ArtifactStore {
  if (!dependencies.artifacts) {
    throw new HttpError(
      503,
      "SERVICE_UNAVAILABLE",
      "Dashboard artifact storage is not configured",
      true,
    );
  }
  return dependencies.artifacts;
}

function contentType(path: string): string {
  if (
    /\.(?:css|csv|html|js|json|jsx|md|svg|toml|ts|tsx|txt|xml|yaml|yml)$/i.test(
      path,
    )
  ) {
    return "text/plain; charset=utf-8";
  }
  return "application/octet-stream";
}

export async function handleRevisionRequest(
  request: Request,
  dependencies: RevisionRouteDependencies,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const dashboardMatch = url.pathname.match(
    /^\/api\/dashboards\/([^/]+)\/revisions$/,
  );
  const revisionMatch = url.pathname.match(
    /^\/api\/revisions\/([^/]+)(?:\/(files|export)(?:\/(.+))?)?$/,
  );
  if (!dashboardMatch && !revisionMatch) return undefined;

  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const principal = await dependencies.authenticate(request);
    if (dashboardMatch) {
      const dashboardId = decode(dashboardMatch[1] ?? "", "Dashboard ID");
      if (request.method === "POST") {
        requirePermission(principal, "dashboard.edit");
        const result = await createDashboardRevision(
          dependencies.db,
          dashboardId,
          await readJson(request, CreateDashboardRevisionRequestSchema),
          principal,
          requireIdempotencyKey(request),
          requestId,
        );
        return Response.json(publicRevision(result.revision), {
          status: result.created ? 201 : 200,
        });
      }
      if (request.method === "GET") {
        requirePermission(principal, "dashboard.read");
        if (
          !(await getDashboard(
            dependencies.db,
            principal.tenantId,
            dashboardId,
          ))
        ) {
          throw new HttpError(
            404,
            "DASHBOARD_NOT_FOUND",
            "Dashboard not found",
          );
        }
        const rawLimit = url.searchParams.get("limit") ?? "50";
        const limit = Number(rawLimit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
          throw new HttpError(
            400,
            "VALIDATION_ERROR",
            "limit must be an integer between 1 and 100",
          );
        }
        const response: DashboardRevisionListResponse = {
          items: (
            await listDashboardRevisions(
              dependencies.db,
              principal.tenantId,
              dashboardId,
              limit,
            )
          ).map(publicRevision),
        };
        return Response.json(response);
      }
      throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
    }

    if (request.method !== "GET") {
      throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
    }
    requirePermission(principal, "dashboard.read");
    const revisionId = decode(revisionMatch?.[1] ?? "", "Revision ID");
    const revision = await getDashboardRevision(
      dependencies.db,
      principal.tenantId,
      revisionId,
    );
    if (!revision) {
      throw new HttpError(
        404,
        "DASHBOARD_REVISION_NOT_FOUND",
        "Dashboard Revision not found",
      );
    }
    const action = revisionMatch?.[2];
    if (!action) return Response.json(publicRevision(revision));

    const snapshot = await loadRevisionSnapshot(
      requireArtifacts(dependencies),
      revision,
    );
    if (action === "export") {
      if (revisionMatch?.[3]) {
        throw new HttpError(404, "NOT_FOUND", "Route not found");
      }
      return new Response(
        Uint8Array.from(createSourceTarGzip(snapshot)).buffer,
        {
          headers: {
            "cache-control": "private, no-store",
            "content-disposition": `attachment; filename="${revision.id}.tar.gz"`,
            "content-type": "application/gzip",
            "x-content-type-options": "nosniff",
          },
        },
      );
    }
    const encodedPath = revisionMatch?.[3];
    if (!encodedPath) {
      const response: DashboardRevisionFileListResponse = {
        items: revisionFiles(snapshot),
      };
      return Response.json(response);
    }
    const path = validateSourcePath(decode(encodedPath, "source path"));
    const file = snapshot.files.find((entry) => entry.path === path);
    if (!file) {
      throw new HttpError(
        404,
        "REVISION_FILE_NOT_FOUND",
        "Revision file not found",
      );
    }
    return new Response(Uint8Array.from(file.bytes).buffer, {
      headers: {
        "cache-control": "private, no-store",
        "content-security-policy": "default-src 'none'; sandbox",
        "content-type": contentType(file.path),
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    if (!(error instanceof HttpError)) {
      console.error(
        JSON.stringify({ event: "request.failed", error: String(error) }),
      );
    }
    return errorResponse(error, requestId);
  }
}
