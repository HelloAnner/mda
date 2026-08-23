import {
  type JdbcDataSourceConfig,
  JdbcDataSourceConfigSchema,
  type JdbcQueryOperation,
  JdbcQueryOperationSchema,
  type QueryResult,
} from "@mda/contracts";
import { Value } from "@sinclair/typebox/value";
import { resolveSecret } from "../secrets.ts";
import {
  type ConnectorQuery,
  type DataSourceConnector,
  validateParameters,
} from "./connector.ts";

export interface JdbcConnectorConfig {
  runnerUrl: string;
  runnerToken: string;
  secretsRoot: string;
}

function validateConfig(config: unknown): JdbcDataSourceConfig {
  if (!Value.Check(JdbcDataSourceConfigSchema, config)) {
    throw new Error("CONFIG_INVALID: Invalid JDBC connector configuration");
  }
  let url: URL;
  try {
    url = new URL(config.jdbcUrl.slice("jdbc:".length));
  } catch {
    throw new Error("CONFIG_INVALID: Invalid JDBC URL");
  }
  if (!url.hostname) {
    throw new Error("CONFIG_INVALID: Invalid JDBC URL");
  }
  if (url.username || url.password) {
    throw new Error("CONFIG_INVALID: JDBC URL must not contain credentials");
  }
  return config;
}

function validateOperation(operation: unknown): JdbcQueryOperation {
  if (!Value.Check(JdbcQueryOperationSchema, operation)) {
    throw new Error("QUERY_INVALID: Invalid JDBC query operation");
  }
  return operation;
}

async function runner(
  connector: JdbcConnectorConfig,
  path: string,
  config: JdbcDataSourceConfig,
  operation?: {
    sql: string;
    parameters: unknown[];
  },
  signal?: AbortSignal,
): Promise<{
  rows: Array<Record<string, unknown>>;
  columns: QueryResult["meta"]["columns"];
  durationMs: number;
}> {
  const timeout = AbortSignal.timeout(
    config.connectionTimeoutMs + config.statementTimeoutMs + 2_000,
  );
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetch(new URL(path, connector.runnerUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${connector.runnerToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      driverId: config.driverId,
      jdbcUrl: config.jdbcUrl,
      username: await resolveSecret(connector.secretsRoot, config.usernameRef),
      password: await resolveSecret(connector.secretsRoot, config.passwordRef),
      connectionTimeoutMs: config.connectionTimeoutMs,
      statementTimeoutMs: config.statementTimeoutMs,
      maxRows: config.maxRows,
      ...(operation ?? {}),
    }),
    signal: requestSignal,
  });
  const value = (await response.json()) as {
    rows?: Array<Record<string, unknown>>;
    columns?: QueryResult["meta"]["columns"];
    durationMs?: number;
    code?: string;
    message?: string;
  };
  if (!response.ok) {
    throw new Error(
      `${value.code ?? "JDBC_RUNNER_UNAVAILABLE"}: ${value.message ?? "JDBC operation failed"}`,
    );
  }
  return {
    rows: value.rows ?? [],
    columns: value.columns ?? [],
    durationMs: value.durationMs ?? 0,
  };
}

async function testConnection(
  connector: JdbcConnectorConfig,
  config: JdbcDataSourceConfig,
  signal?: AbortSignal,
): Promise<{ latencyMs: number }> {
  const result = await runner(connector, "/v1/test", config, undefined, signal);
  return { latencyMs: result.durationMs };
}

async function execute(
  connector: JdbcConnectorConfig,
  config: JdbcDataSourceConfig,
  query: ConnectorQuery,
  parameters: Record<string, string | number | boolean | null>,
  signal?: AbortSignal,
): Promise<QueryResult> {
  validateParameters(query, parameters);
  const operation = validateOperation(query.operation);
  const ordered = query.parameters.map(
    (definition) => parameters[definition.name] ?? null,
  );
  const result = await runner(
    connector,
    "/v1/execute",
    config,
    { sql: operation.sql, parameters: ordered },
    signal,
  );
  return {
    rows: result.rows,
    meta: {
      columns: result.columns,
      rowCount: result.rows.length,
      truncated: result.rows.length >= config.maxRows,
      durationMs: result.durationMs,
      fetchedAt: new Date().toISOString(),
      cache: { hit: false },
    },
  };
}

export function createJdbcConnector(
  connector: JdbcConnectorConfig,
): DataSourceConnector {
  return {
    kind: "jdbc",
    capabilities: {
      schema: "declared",
      snapshotRead: "native",
      incrementalRead: "unsupported",
      mutations: {
        insert: "unsupported",
        update: "unsupported",
        delete: "unsupported",
      },
    },
    validateConfig,
    testConnection(context) {
      return testConnection(
        connector,
        validateConfig(context.config),
        context.signal,
      );
    },
    async describe(context) {
      validateConfig(context.config);
      return { entities: structuredClone(context.declaredEntities) };
    },
    execute(context) {
      return execute(
        connector,
        validateConfig(context.config),
        context.query,
        context.parameters,
        context.signal,
      );
    },
  };
}
