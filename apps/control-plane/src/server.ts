import {
  type ApiError,
  CONTRACT_VERSION,
  type HealthResponse,
  type ServiceMetadata,
} from "@mda/contracts";
import packageJson from "../package.json" with { type: "json" };

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

export function startServer(
  port = Number(Bun.env.PORT ?? 8080),
  hostname = Bun.env.HOST ?? "0.0.0.0",
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
      "/health/ready": () => Response.json(health),
    },
    fetch() {
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
  const server = startServer();
  console.log(
    JSON.stringify({
      event: "server.started",
      service,
      url: server.url.href,
      version: packageJson.version,
    }),
  );
}
