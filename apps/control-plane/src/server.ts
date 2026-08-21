import {
  type ApiError,
  CONTRACT_VERSION,
  type HealthResponse,
  type ServiceMetadata,
} from "@mda/contracts";
import type { SQL } from "bun";
import packageJson from "../package.json" with { type: "json" };
import { loadConfig } from "./config.ts";
import { handleDashboardRequest } from "./contexts/dashboards/routes.ts";
import { createAuthenticator, type PrincipalContext } from "./shared/auth.ts";
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
        const response = await handleDashboardRequest(request, dependencies);
        if (response) return response;
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
  const server = startServer(config.port, config.hostname, {
    db,
    authenticate: createAuthenticator(config, db),
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
