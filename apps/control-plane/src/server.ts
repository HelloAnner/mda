import {
  type ApiError,
  CONTRACT_VERSION,
  type HealthResponse,
  type ServiceMetadata,
} from "@mda/contracts";
import { RedisClient, type SQL } from "bun";
import packageJson from "../package.json" with { type: "json" };
import { DataSourceClient } from "./adapters/data-source-client.ts";
import { loadConfig } from "./config.ts";
import { startAgentJobDispatcher } from "./contexts/agent-work/dispatch.ts";
import { handleAgentWorkRequest } from "./contexts/agent-work/routes.ts";
import { handleDashboardFolderRequest } from "./contexts/dashboard-folders/routes.ts";
import { handleDashboardRequest } from "./contexts/dashboards/routes.ts";
import { handleAgentDataRequest } from "./contexts/data-access/agent-routes.ts";
import { handleDataAccessRequest } from "./contexts/data-access/routes.ts";
import { handlePreviewRequest } from "./contexts/previews/routes.ts";
import { handlePublicationRequest } from "./contexts/publications/routes.ts";
import { handleRevisionRequest } from "./contexts/revisions/routes.ts";
import { handleShareRequest } from "./contexts/shares/routes.ts";
import { type ArtifactStore, S3ArtifactStore } from "./shared/artifacts.ts";
import {
  authorizeGlobalAccess,
  createAuthenticator,
  createLocalAuthenticator,
  ensureLocalPrincipal,
  type PrincipalContext,
} from "./shared/auth.ts";
import { createDatabase } from "./shared/db.ts";
import { errorResponse, HttpError } from "./shared/http.ts";

const service = "mda-main";
const health: HealthResponse = {
  service,
  status: "ok",
  version: packageJson.version,
};
const metadata: ServiceMetadata = {
  service,
  version: packageJson.version,
  contractVersion: CONTRACT_VERSION,
};

interface ServerDependencies {
  db: SQL;
  authenticate(request: Request): Promise<PrincipalContext>;
  internalAgentToken?: string;
  agentLeaseMs?: number;
  accessPassword?: string;
  redis?: RedisClient;
  artifacts?: ArtifactStore;
  previewSigningKey?: string;
  previewTtlSeconds?: number;
  shareSigningKey?: string;
  dataSources?: DataSourceClient;
  webRoot?: string;
}

const defaultWebRoot = new URL("../../web/dist/", import.meta.url).pathname;
const webHeaders = {
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "cross-origin-opener-policy": "same-origin",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

async function serveWebAsset(
  request: Request,
  root: string,
): Promise<Response | undefined> {
  if (request.method !== "GET" && request.method !== "HEAD") return undefined;
  const pathname = new URL(request.url).pathname;
  const relative =
    pathname === "/"
      ? "index.html"
      : /^\/(?:assets\/[A-Za-z0-9._-]+|fonts\/[A-Za-z0-9._/-]+|favicon\.svg|manifest\.webmanifest)$/.test(
            pathname,
          ) && !pathname.includes("..")
        ? pathname.slice(1)
        : undefined;
  if (!relative) return undefined;
  const file = Bun.file(`${root.replace(/\/$/, "")}/${relative}`);
  if (!(await file.exists())) return undefined;
  const headers = new Headers(webHeaders);
  headers.set(
    "cache-control",
    relative === "index.html"
      ? "no-cache"
      : "public, max-age=31536000, immutable",
  );
  if (file.type) headers.set("content-type", file.type);
  return new Response(request.method === "HEAD" ? null : file, { headers });
}

export function startServer(
  port = Number(Bun.env.PORT ?? 8080),
  hostname = Bun.env.HOST ?? "0.0.0.0",
  dependencies?: ServerDependencies,
) {
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("PORT must be an integer between 0 and 65535");
  }

  return Bun.serve({
    hostname,
    port,
    routes: {
      "/api/meta": () => Response.json(metadata),
      "/health/live": () => Response.json(health),
      "/health/ready": async () => {
        if (!dependencies) return Response.json(health);
        try {
          await dependencies.db`SELECT 1`;
          if (dependencies.redis) await dependencies.redis.ping();
          if (dependencies.artifacts) await dependencies.artifacts.ready();
          if (dependencies.dataSources) {
            const response = await dependencies.dataSources.ready();
            if (!response.ok)
              throw new Error("Data Source Service is not ready");
          }
          return Response.json(health);
        } catch {
          return errorResponse(
            new HttpError(
              503,
              "SERVICE_UNAVAILABLE",
              "Control Plane is not ready",
              true,
            ),
          );
        }
      },
    },
    async fetch(request) {
      const webResponse = await serveWebAsset(
        request,
        dependencies?.webRoot ?? Bun.env.MDA_WEB_ROOT ?? defaultWebRoot,
      );
      if (webResponse) return webResponse;
      if (dependencies) {
        if (
          dependencies.accessPassword &&
          new URL(request.url).pathname.startsWith("/api/")
        ) {
          try {
            authorizeGlobalAccess(request, dependencies.accessPassword);
          } catch (error) {
            return errorResponse(
              error,
              request.headers.get("x-request-id") ?? crypto.randomUUID(),
            );
          }
        }
        const agentDataResponse = await handleAgentDataRequest(
          request,
          dependencies,
        );
        if (agentDataResponse) return agentDataResponse;
        const dataAccessResponse = await handleDataAccessRequest(
          request,
          dependencies,
        );
        if (dataAccessResponse) return dataAccessResponse;
        const shareResponse = await handleShareRequest(request, dependencies);
        if (shareResponse) return shareResponse;
        const publicationResponse = await handlePublicationRequest(
          request,
          dependencies,
        );
        if (publicationResponse) return publicationResponse;
        const previewResponse = await handlePreviewRequest(
          request,
          dependencies,
        );
        if (previewResponse) return previewResponse;
        const agentResponse = await handleAgentWorkRequest(
          request,
          dependencies,
        );
        if (agentResponse) return agentResponse;
        const revisionResponse = await handleRevisionRequest(
          request,
          dependencies,
        );
        if (revisionResponse) return revisionResponse;
        const folderResponse = await handleDashboardFolderRequest(
          request,
          dependencies,
        );
        if (folderResponse) return folderResponse;
        const dashboardResponse = await handleDashboardRequest(
          request,
          dependencies,
        );
        if (dashboardResponse) return dashboardResponse;
      }

      const error: ApiError = {
        code: "NOT_FOUND",
        message: "Route not found",
        requestId: crypto.randomUUID(),
        retryable: false,
      };
      return Response.json(error, { status: 404 });
    },
  });
}

if (import.meta.main) {
  const config = loadConfig();
  const db = createDatabase(config.databaseUrl);
  const redis = new RedisClient(config.redisUrl);
  await redis.connect();
  const artifacts = new S3ArtifactStore({
    endpoint: config.artifactEndpoint,
    bucket: config.artifactBucket,
    region: config.artifactRegion,
    accessKeyId: config.artifactAccessKeyId,
    secretAccessKey: config.artifactSecretAccessKey,
  });
  await artifacts.ready();
  startAgentJobDispatcher(db, redis);
  if (config.authMode === "password") {
    await ensureLocalPrincipal(db, config.localTenantId, config.localUserId);
  }
  const authenticate =
    config.authMode === "password"
      ? createLocalAuthenticator(db, config.localTenantId, config.localUserId)
      : createAuthenticator(
          {
            oidcIssuer: config.oidcIssuer as string,
            oidcAudience: config.oidcAudience as string,
            oidcJwksUrl: config.oidcJwksUrl as string,
          },
          db,
        );
  const dataSources = new DataSourceClient(
    config.dataSourceUrl,
    config.dataSourceInternalToken,
  );
  const server = startServer(config.port, config.hostname, {
    db,
    authenticate,
    internalAgentToken: config.internalAgentToken,
    agentLeaseMs: config.agentLeaseMs,
    accessPassword: config.accessPassword,
    redis,
    artifacts,
    previewSigningKey: config.previewSigningKey,
    previewTtlSeconds: config.previewTtlSeconds,
    shareSigningKey: config.shareSigningKey,
    dataSources,
  });
  console.log(
    JSON.stringify({
      event: "server.started",
      service,
      url: server.url.href,
      version: packageJson.version,
    }),
  );
}
