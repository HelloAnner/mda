import {
  type ApiError,
  CONTRACT_VERSION,
  type HealthResponse,
  type ServiceMetadata,
} from "@mda/contracts";
import { RedisClient, type SQL } from "bun";
import packageJson from "../package.json" with { type: "json" };
import { loadConfig } from "./config.ts";
import { startAgentJobDispatcher } from "./contexts/agent-work/dispatch.ts";
import { handleAgentWorkRequest } from "./contexts/agent-work/routes.ts";
import { handleDashboardRequest } from "./contexts/dashboards/routes.ts";
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
