import type {
  JdbcDataSourceConfig,
  JdbcQueryOperation,
  QueryResult,
  RegisteredQuery,
} from "@mda/contracts";
import { resolveSecret } from "./secrets.ts";

export interface JdbcConnectorConfig {
  runnerUrl: string;
  runnerToken: string;
  secretsRoot: string;
}

async function runner(
  connector: JdbcConnectorConfig,
  path: string,
  config: JdbcDataSourceConfig,
  operation?: {
    sql: string;
    parameters: unknown[];
  },
): Promise<{
  rows: Array<Record<string, unknown>>;
  columns: Array<{
    name: string;
    type: "string" | "integer" | "number" | "boolean" | "date" | "datetime";
    nullable: boolean;
  }>;
  durationMs: number;
}> {
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
    signal: AbortSignal.timeout(
      config.connectionTimeoutMs + config.statementTimeoutMs + 2_000,
    ),
  });
  const value = (await response.json()) as {
    rows?: Array<Record<string, unknown>>;
    columns?: Array<{
      name: string;
      type: "string" | "integer" | "number" | "boolean" | "date" | "datetime";
      nullable: boolean;
    }>;
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

export async function testJdbcSource(
  connector: JdbcConnectorConfig,
  config: JdbcDataSourceConfig,
): Promise<{ latencyMs: number }> {
  const result = await runner(connector, "/v1/test", config);
  return { latencyMs: result.durationMs };
}

export async function executeJdbcQuery(
  connector: JdbcConnectorConfig,
  config: JdbcDataSourceConfig,
  query: Pick<RegisteredQuery, "operation" | "parameters" | "columns">,
  parameters: Record<string, string | number | boolean | null>,
): Promise<QueryResult> {
  const ordered: unknown[] = [];
  for (const definition of query.parameters) {
    const value = parameters[definition.name];
    if (value === undefined && definition.required) {
      throw new Error(`PARAMETER_INVALID: Missing ${definition.name}`);
    }
    ordered.push(value ?? null);
  }
  const operation = query.operation as JdbcQueryOperation;
  const result = await runner(connector, "/v1/execute", config, {
    sql: operation.sql,
    parameters: ordered,
  });
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
