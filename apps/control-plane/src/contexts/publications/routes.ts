import {
  CreatePublicationRequestSchema,
  type Publication,
  type PublicationBuild,
  UploadPublicationRequestSchema,
} from "@mda/contracts";
import type { SQL } from "bun";
import type { DataSourceClient } from "../../adapters/data-source-client.ts";
import type { ArtifactStore } from "../../shared/artifacts.ts";
import {
  authorizeInternalRequest,
  type PrincipalContext,
  requirePermission,
} from "../../shared/auth.ts";
import {
  errorResponse,
  HttpError,
  readJson,
  requireIdempotencyKey,
} from "../../shared/http.ts";
import {
  createPublicationBuild,
  getPublication,
  getPublicationBuild,
  listPublications,
  type PublicationBuildRecord,
  type PublicationRecord,
} from "./postgres.ts";
import {
  exportPublicationBundle,
  storePublicationArtifact,
} from "./service.ts";

interface PublicationRouteDependencies {
  db: SQL;
  artifacts?: ArtifactStore;
  authenticate(request: Request): Promise<PrincipalContext>;
  internalAgentToken?: string;
  dataSources?: DataSourceClient;
}

function decode(value: string, label: string): string {
  try {
    const decoded = decodeURIComponent(value);
    if (!decoded) throw new Error("empty");
    return decoded;
  } catch {
    throw new HttpError(400, "VALIDATION_ERROR", `Invalid ${label}`);
  }
}

function requireArtifacts(
  dependencies: PublicationRouteDependencies,
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

function publicBuild(record: PublicationBuildRecord): PublicationBuild {
  const {
    tenantId: _tenantId,
    checkpointId: _checkpointId,
    requestedBy: _requestedBy,
    requestId: _requestId,
    ...build
  } = record;
  return build;
}

function publicPublication(record: PublicationRecord): Publication {
  const {
    tenantId: _tenantId,
    artifactKey: _artifactKey,
    ...publication
  } = record;
  return publication;
}

export async function handlePublicationRequest(
  request: Request,
  dependencies: PublicationRouteDependencies,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const collectionMatch = url.pathname.match(
    /^\/api\/dashboards\/([^/]+)\/publications$/,
  );
  const buildMatch = url.pathname.match(/^\/api\/publication-builds\/([^/]+)$/);
  const itemMatch = url.pathname.match(
    /^\/api\/publications\/([^/]+)(?:\/(export))?$/,
  );
  const internalMatch = url.pathname.match(
    /^\/internal\/v1\/agent-jobs\/([^/]+)\/publication$/,
  );
  if (!collectionMatch && !buildMatch && !itemMatch && !internalMatch) {
    return undefined;
  }

  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    if (internalMatch) {
      if (!dependencies.internalAgentToken) {
        throw new HttpError(
          503,
          "SERVICE_UNAVAILABLE",
          "Internal Agent API is not configured",
          true,
        );
      }
      authorizeInternalRequest(request, dependencies.internalAgentToken);
      if (request.method !== "POST") {
        throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
      }
      const input = await readJson(request, UploadPublicationRequestSchema);
      return Response.json(
        await storePublicationArtifact(
          dependencies.db,
          requireArtifacts(dependencies),
          dependencies.dataSources,
          decode(internalMatch[1] ?? "", "Agent Job ID"),
          input,
          input.artifact,
        ),
      );
    }

    const principal = await dependencies.authenticate(request);
    requirePermission(principal, "dashboard.read");

    if (collectionMatch) {
      const dashboardId = decode(collectionMatch[1] ?? "", "Dashboard ID");
      if (request.method === "POST") {
        requirePermission(principal, "dashboard.edit");
        const result = await createPublicationBuild(
          dependencies.db,
          dashboardId,
          await readJson(request, CreatePublicationRequestSchema),
          principal,
          requireIdempotencyKey(request),
          requestId,
        );
        return Response.json(
          { build: publicBuild(result.build), job: result.job },
          { status: result.created ? 202 : 200 },
        );
      }
      if (request.method !== "GET") {
        throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
      }
      const limit = Number(url.searchParams.get("limit") ?? "50");
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new HttpError(400, "VALIDATION_ERROR", "Invalid limit");
      }
      const publications = await listPublications(
        dependencies.db,
        principal.tenantId,
        dashboardId,
        limit,
      );
      return Response.json({
        items: publications.map(publicPublication),
      });
    }

    if (buildMatch) {
      if (request.method !== "GET") {
        throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
      }
      const build = await getPublicationBuild(
        dependencies.db,
        principal.tenantId,
        decode(buildMatch[1] ?? "", "Publication Build ID"),
      );
      if (!build) {
        throw new HttpError(
          404,
          "PUBLICATION_BUILD_NOT_FOUND",
          "Publication Build not found",
        );
      }
      return Response.json(publicBuild(build));
    }

    if (request.method !== "GET") {
      throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
    }
    const publication = await getPublication(
      dependencies.db,
      principal.tenantId,
      decode(itemMatch?.[1] ?? "", "Publication ID"),
    );
    if (!publication) {
      throw new HttpError(
        404,
        "PUBLICATION_NOT_FOUND",
        "Publication not found",
      );
    }
    if (itemMatch?.[2] === "export") {
      const archive = await exportPublicationBundle(
        requireArtifacts(dependencies),
        publication,
      );
      return new Response(Buffer.from(archive), {
        headers: {
          "cache-control": "private, no-store",
          "content-disposition": `attachment; filename="${publication.id}.tar.gz"`,
          "content-type": "application/gzip",
          "x-content-type-options": "nosniff",
          "x-mda-content-digest": publication.buildDigest,
        },
      });
    }
    return Response.json(publicPublication(publication));
  } catch (error) {
    if (!(error instanceof HttpError)) {
      console.error(
        JSON.stringify({ event: "request.failed", error: String(error) }),
      );
    }
    return errorResponse(error, requestId);
  }
}
