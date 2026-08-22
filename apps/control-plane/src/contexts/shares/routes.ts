import {
  CreateShareLinkRequestSchema,
  ExecuteQueryRequestSchema,
  type ShareLink,
} from "@mda/contracts";
import type { SQL } from "bun";
import type { DataSourceClient } from "../../adapters/data-source-client.ts";
import type { ArtifactStore } from "../../shared/artifacts.ts";
import { type PrincipalContext, requirePermission } from "../../shared/auth.ts";
import {
  errorResponse,
  HttpError,
  readJson,
  requireIdempotencyKey,
} from "../../shared/http.ts";
import {
  getPublication,
  getPublicationQueryBinding,
} from "../publications/postgres.ts";
import { readPublicationFile } from "../publications/service.ts";
import {
  createShareLink,
  getShareLink,
  getShareLinkByTokenDigest,
  listShareLinks,
  revokeShareLink,
  type ShareLinkRecord,
} from "./postgres.ts";
import { sharePath, shareTokenDigest } from "./token.ts";

interface ShareRouteDependencies {
  db: SQL;
  artifacts?: ArtifactStore;
  authenticate(request: Request): Promise<PrincipalContext>;
  shareSigningKey?: string;
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

function requireArtifacts(dependencies: ShareRouteDependencies): ArtifactStore {
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

function requireSigningKey(dependencies: ShareRouteDependencies): string {
  if (!dependencies.shareSigningKey) {
    throw new HttpError(
      503,
      "SERVICE_UNAVAILABLE",
      "Share Link delivery is not configured",
      true,
    );
  }
  return dependencies.shareSigningKey;
}

function publicShareLink(record: ShareLinkRecord): ShareLink {
  const {
    tenantId: _tenantId,
    tokenDigest: _tokenDigest,
    ...shareLink
  } = record;
  return shareLink;
}

const deliveryHeaders = {
  "access-control-allow-origin": "*",
  "cross-origin-resource-policy": "cross-origin",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

export async function handleShareRequest(
  request: Request,
  dependencies: ShareRouteDependencies,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const createMatch = url.pathname.match(
    /^\/api\/publications\/([^/]+)\/share-links$/,
  );
  const listMatch = url.pathname.match(
    /^\/api\/dashboards\/([^/]+)\/share-links$/,
  );
  const itemMatch = url.pathname.match(
    /^\/api\/share-links\/([^/]+)(?:\/(revoke))?$/,
  );
  const deliveryMatch = url.pathname.match(/^\/s\/([^/]+)(?:\/(.*))?$/);
  if (!createMatch && !listMatch && !itemMatch && !deliveryMatch) {
    return undefined;
  }

  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const signingKey = requireSigningKey(dependencies);
    if (deliveryMatch) {
      const token = decode(deliveryMatch[1] ?? "", "Share token");
      const shareLink = await getShareLinkByTokenDigest(
        dependencies.db,
        shareTokenDigest(token),
      );
      if (!shareLink) {
        throw new HttpError(404, "SHARE_LINK_NOT_FOUND", "Not found");
      }
      if (shareLink.status !== "active") {
        throw new HttpError(
          410,
          shareLink.status === "revoked"
            ? "SHARE_LINK_REVOKED"
            : "SHARE_LINK_EXPIRED",
          shareLink.status === "revoked"
            ? "Share Link has been revoked"
            : "Share Link has expired",
        );
      }
      const publication = await getPublication(
        dependencies.db,
        shareLink.tenantId,
        shareLink.publicationId,
      );
      if (!publication) {
        throw new HttpError(404, "SHARE_LINK_NOT_FOUND", "Not found");
      }
      const path = deliveryMatch[2]
        ? decode(deliveryMatch[2], "Publication path")
        : "index.html";
      if (path.startsWith("__mda/query/")) {
        if (request.method !== "POST") {
          throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
        }
        if (!dependencies.dataSources) {
          throw new HttpError(
            503,
            "DATA_SOURCE_UNAVAILABLE",
            "Data Source Service is unavailable",
            true,
          );
        }
        const logicalName = decode(
          path.slice("__mda/query/".length),
          "Query ID",
        );
        const binding = await getPublicationQueryBinding(
          dependencies.db,
          publication.id,
          logicalName,
        );
        if (!binding?.publicExecution) {
          throw new HttpError(404, "QUERY_NOT_FOUND", "Query not found");
        }
        const input = await readJson(request, ExecuteQueryRequestSchema);
        const result = await dependencies.dataSources.execute(
          {
            tenantId: shareLink.tenantId,
            userId: `share:${shareLink.id}`,
          },
          binding.queryId,
          { revision: binding.revision, parameters: input.parameters },
          true,
        );
        return Response.json(result, {
          headers: {
            "access-control-allow-origin": "*",
            "cache-control": "public, no-store",
            "referrer-policy": "no-referrer",
            "x-content-type-options": "nosniff",
          },
        });
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
      }
      const file = await readPublicationFile(
        requireArtifacts(dependencies),
        publication,
        path || "index.html",
      );
      const headers = new Headers(deliveryHeaders);
      headers.set("content-type", file.mediaType);
      if (file.mediaType.startsWith("text/html")) {
        headers.set("cache-control", "public, no-store");
        headers.set(
          "content-security-policy",
          "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; media-src 'self' blob:; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors *; sandbox allow-scripts allow-forms allow-modals allow-popups",
        );
      } else {
        headers.set("cache-control", "public, max-age=31536000, immutable");
      }
      return new Response(
        request.method === "HEAD" ? null : Buffer.from(file.bytes),
        { headers },
      );
    }

    const principal = await dependencies.authenticate(request);
    requirePermission(principal, "dashboard.read");

    if (createMatch) {
      if (request.method !== "POST") {
        throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
      }
      requirePermission(principal, "dashboard.edit");
      const result = await createShareLink(
        dependencies.db,
        decode(createMatch[1] ?? "", "Publication ID"),
        await readJson(request, CreateShareLinkRequestSchema),
        principal,
        requireIdempotencyKey(request),
        requestId,
        signingKey,
      );
      return Response.json(
        {
          shareLink: publicShareLink(result.shareLink),
          url: new URL(sharePath(result.token), request.url).href,
        },
        { status: result.created ? 201 : 200 },
      );
    }

    if (listMatch) {
      if (request.method !== "GET") {
        throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
      }
      const limit = Number(url.searchParams.get("limit") ?? "50");
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new HttpError(400, "VALIDATION_ERROR", "Invalid limit");
      }
      const links = await listShareLinks(
        dependencies.db,
        principal.tenantId,
        decode(listMatch[1] ?? "", "Dashboard ID"),
        limit,
      );
      return Response.json({ items: links.map(publicShareLink) });
    }

    const id = decode(itemMatch?.[1] ?? "", "Share Link ID");
    if (itemMatch?.[2] === "revoke") {
      if (request.method !== "POST") {
        throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
      }
      requirePermission(principal, "dashboard.edit");
      return Response.json(
        publicShareLink(
          await revokeShareLink(
            dependencies.db,
            principal.tenantId,
            id,
            principal.userId,
            requestId,
          ),
        ),
      );
    }
    if (request.method !== "GET") {
      throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
    }
    const link = await getShareLink(dependencies.db, principal.tenantId, id);
    if (!link) {
      throw new HttpError(404, "SHARE_LINK_NOT_FOUND", "Share Link not found");
    }
    return Response.json(publicShareLink(link));
  } catch (error) {
    if (!(error instanceof HttpError)) {
      console.error(
        JSON.stringify({ event: "request.failed", error: String(error) }),
      );
    }
    return errorResponse(error, requestId);
  }
}
