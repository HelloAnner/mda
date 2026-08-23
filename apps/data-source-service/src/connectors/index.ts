import { ConnectorRegistry } from "./connector.ts";
import { createHttpConnector } from "./http.ts";
import { createJdbcConnector, type JdbcConnectorConfig } from "./jdbc.ts";

export function createConnectorRegistry(
  config: JdbcConnectorConfig,
): ConnectorRegistry {
  return new ConnectorRegistry([
    createHttpConnector(config.secretsRoot),
    createJdbcConnector(config),
  ]);
}

export { ConnectorRegistry } from "./connector.ts";
export type { JdbcConnectorConfig } from "./jdbc.ts";
