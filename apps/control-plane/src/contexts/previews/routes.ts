import {
  CreateDashboardPreviewRequestSchema,
  type DashboardPreview,
  UploadDashboardPreviewRequestSchema,
} from "@mda/contracts";
import type { SQL } from "bun";
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
  createDashboardPreview,
  getDashboardPreview,
  getDashboardPreviewForDelivery,
  listDashboardPreviews,
  type PreviewRecord,
} from "./postgres.ts";
import { readPreviewFile, storePreviewArtifact } from "./service.ts";
import { previewPath, verifyPreviewToken } from "./token.ts";

interface PreviewRouteDependencies {
  db: SQL;
  artifacts?: ArtifactStore;
  authenticate(request: Request): Promise<PrincipalContext>;
  internalAgentToken?: string;
  previewSigningKey?: string;
  previewTtlSeconds?: number;
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
  dependencies: PreviewRouteDependencies,
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

function requireSigningKey(dependencies: PreviewRouteDependencies): string {
  if (!dependencies.previewSigningKey) {
    throw new HttpError(
      503,
      "SERVICE_UNAVAILABLE",
      "Preview delivery is not configured",
      true,
    );
  }
  return dependencies.previewSigningKey;
}

function publicPreview(
  record: PreviewRecord,
  request: Request,
  signingKey: string,
): DashboardPreview {
  const { tenantId: _tenantId, artifactKey: _artifactKey, ...preview } = record;
  return {
    ...preview,
    url: new URL(
      previewPath(signingKey, record.id, record.expiresAt),
      request.url,
    ).href,
  };
}

const previewHeaders = {
  "access-control-allow-origin": "*",
  "cross-origin-resource-policy": "cross-origin",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

export async function handlePreviewRequest(
  request: Request,
  dependencies: PreviewRouteDependencies,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const collectionMatch = url.pathname.match(
    /^\/api\/dashboards\/([^/]+)\/previews$/,
  );
  const itemMatch = url.pathname.match(/^\/api\/previews\/([^/]+)$/);
  const internalMatch = url.pathname.match(
    /^\/internal\/v1\/agent-jobs\/([^/]+)\/preview$/,
  );
  const deliveryMatch = url.pathname.match(
    /^\/p\/([^/]+)\/([^/]+)(?:\/(.*))?$/,
  );
  if (!collectionMatch && !itemMatch && !internalMatch && !deliveryMatch) {
    return undefined;
  }

  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const signingKey = requireSigningKey(dependencies);
    const ttlSeconds = dependencies.previewTtlSeconds ?? 3_600;

    if (deliveryMatch) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
      }
      const previewId = decode(deliveryMatch[1] ?? "", "Preview ID");
      const token = decode(deliveryMatch[2] ?? "", "Preview token");
      const preview = await getDashboardPreviewForDelivery(
        dependencies.db,
        previewId,
      );
      if (
        !preview ||
        !verifyPreviewToken(signingKey, preview.id, preview.expiresAt, token)
      ) {
        throw new HttpError(404, "PREVIEW_NOT_FOUND", "Preview not found");
      }
      if (preview.status === "expired") {
        throw new HttpError(410, "PREVIEW_EXPIRED", "Preview has expired");
      }
      const path = deliveryMatch[3]
        ? decode(deliveryMatch[3], "Preview path")
        : "index.html";
      const file = await readPreviewFile(
        requireArtifacts(dependencies),
        preview,
        path || "index.html",
      );
      const headers = new Headers(previewHeaders);
      headers.set("content-type", file.mediaType);
      if (file.mediaType.startsWith("text/html")) {
        headers.set("cache-control", "private, no-store");
        headers.set(
          "content-security-policy",
          "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; media-src 'self' blob:; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors *; sandbox allow-scripts allow-forms allow-modals allow-popups",
        );
      } else {
        headers.set("cache-control", "private, max-age=3600, immutable");
      }
      return new Response(
        request.method === "HEAD" ? null : Buffer.from(file.bytes),
        {
          headers,
        },
      );
    }

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
      const input = await readJson(
        request,
        UploadDashboardPreviewRequestSchema,
      );
      return Response.json(
        await storePreviewArtifact(
          dependencies.db,
          requireArtifacts(dependencies),
          signingKey,
          ttlSeconds,
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
        const result = await createDashboardPreview(
          dependencies.db,
          dashboardId,
          await readJson(request, CreateDashboardPreviewRequestSchema),
          principal,
          requireIdempotencyKey(request),
          requestId,
          ttlSeconds,
        );
        return Response.json(
          {
            preview: publicPreview(result.preview, request, signingKey),
            job: result.job,
          },
          { status: result.created ? 202 : 200 },
        );
      }
      if (request.method !== "GET") {
        throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
      }
      const limit = Number(url.searchParams.get("limit") ?? "20");
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new HttpError(400, "VALIDATION_ERROR", "Invalid limit");
      }
      const previews = await listDashboardPreviews(
        dependencies.db,
        principal.tenantId,
        dashboardId,
        limit,
      );
      return Response.json({
        items: previews.map((preview) =>
          publicPreview(preview, request, signingKey),
        ),
      });
    }

    if (request.method !== "GET") {
      throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
    }
    const preview = await getDashboardPreview(
      dependencies.db,
      principal.tenantId,
      decode(itemMatch?.[1] ?? "", "Preview ID"),
    );
    if (!preview) {
      throw new HttpError(404, "PREVIEW_NOT_FOUND", "Preview not found");
    }
    return Response.json(publicPreview(preview, request, signingKey));
  } catch (error) {
    if (!(error instanceof HttpError)) {
      console.error(
        JSON.stringify({ event: "request.failed", error: String(error) }),
      );
    }
    return errorResponse(error, requestId);
  }
}
