import { lookup } from "node:dns/promises";
import {
  type HttpDataSourceConfig,
  HttpDataSourceConfigSchema,
  type HttpQueryOperation,
  HttpQueryOperationSchema,
  type QueryResult,
} from "@mda/contracts";
import { Value } from "@sinclair/typebox/value";
import { resolveSecret } from "../secrets.ts";
import {
  type ConnectorQuery,
  type DataSourceConnector,
  validateParameters,
} from "./connector.ts";

function validateBaseUrl(config: HttpDataSourceConfig): URL {
  let url: URL;
  try {
    url = new URL(config.baseUrl);
  } catch {
    throw new Error("CONFIG_INVALID: Invalid HTTP base URL");
  }
  if (url.username || url.password) {
    throw new Error("CONFIG_INVALID: URL credentials are forbidden");
  }
  if (url.protocol !== "https:" && !config.allowPrivateNetwork) {
    throw new Error("HTTP_DESTINATION_BLOCKED: HTTPS is required");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("HTTP_DESTINATION_BLOCKED: Unsupported URL protocol");
  }
  return url;
}

function validateConfig(config: unknown): HttpDataSourceConfig {
  if (!Value.Check(HttpDataSourceConfigSchema, config)) {
    throw new Error("CONFIG_INVALID: Invalid HTTP connector configuration");
  }
  validateBaseUrl(config);
  return config;
}

function validateOperation(operation: unknown): HttpQueryOperation {
  if (!Value.Check(HttpQueryOperationSchema, operation)) {
    throw new Error("QUERY_INVALID: Invalid HTTP query operation");
  }
  return operation;
}

async function authorization(
  config: HttpDataSourceConfig,
  secretsRoot: string,
): Promise<Record<string, string>> {
  if (!config.auth || config.auth.type === "none") return {};
  return {
    authorization: `Bearer ${await resolveSecret(secretsRoot, config.auth.secretRef)}`,
  };
}

function privateAddress(address: string): boolean {
  if (address === "::1" || address === "0:0:0:0:0:0:0:1") return true;
  if (address.includes(":")) {
    const normalized = address.toLowerCase();
    return (
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:")
    );
  }
  const octets = address.split(".").map(Number);
  const [first, second] = octets;
  return (
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second !== undefined && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first === 0
  );
}

export async function validateDestination(
  config: HttpDataSourceConfig,
): Promise<URL> {
  const url = validateBaseUrl(config);
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (
    !config.allowPrivateNetwork &&
    addresses.some(({ address }) => privateAddress(address))
  ) {
    throw new Error("HTTP_DESTINATION_BLOCKED: Private destination blocked");
  }
  return url;
}

function resolvePointer(value: unknown, pointer: string): unknown {
  if (!pointer) return value;
  if (!pointer.startsWith("/")) {
    throw new Error("QUERY_INVALID: rowsPointer must be a JSON Pointer");
  }
  return pointer
    .slice(1)
    .split("/")
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce<unknown>((current, part) => {
      if (!current || typeof current !== "object") return undefined;
      return (current as Record<string, unknown>)[part];
    }, value);
}

function inferType(
  value: unknown,
): "string" | "integer" | "number" | "boolean" | "json" {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") {
    return Number.isInteger(value) ? "integer" : "number";
  }
  if (typeof value === "string") return "string";
  return "json";
}

function inferColumns(rows: Array<Record<string, unknown>>) {
  const names = new Set(rows.slice(0, 100).flatMap((row) => Object.keys(row)));
  return [...names].sort().map((name) => {
    const values = rows.slice(0, 100).map((row) => row[name]);
    const first = values.find((value) => value !== null && value !== undefined);
    return {
      name,
      type: inferType(first),
      nullable: values.some((value) => value === null || value === undefined),
    };
  });
}

async function execute(
  config: HttpDataSourceConfig,
  query: ConnectorQuery,
  parameters: Record<string, string | number | boolean | null>,
  secretsRoot: string,
  signal?: AbortSignal,
): Promise<QueryResult> {
  const started = performance.now();
  const base = await validateDestination(config);
  const operation = validateOperation(query.operation);
  validateParameters(query, parameters);
  if (!operation.path.startsWith("/") || operation.path.startsWith("//")) {
    throw new Error("QUERY_INVALID: HTTP path must be relative to the source");
  }
  const target = new URL(operation.path, base);
  if (target.origin !== base.origin) {
    throw new Error(
      "HTTP_DESTINATION_BLOCKED: Query cannot change source host",
    );
  }
  for (const [targetName, parameterName] of Object.entries(
    operation.query ?? {},
  )) {
    const value = parameters[parameterName];
    if (value !== undefined && value !== null) {
      target.searchParams.set(targetName, String(value));
    }
  }
  const timeout = AbortSignal.timeout(config.timeoutMs);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetch(target, {
    method: operation.method,
    headers: {
      accept: "application/json",
      ...(await authorization(config, secretsRoot)),
      ...(operation.method === "POST"
        ? { "content-type": "application/json" }
        : {}),
    },
    ...(operation.method === "POST"
      ? { body: JSON.stringify(operation.body ?? {}) }
      : {}),
    redirect: "error",
    signal: requestSignal,
  });
  if (!response.ok) {
    throw new Error(
      `EXECUTION_FAILED: Source returned HTTP ${response.status}`,
    );
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error("HTTP_RESPONSE_INVALID: Source did not return JSON");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > config.maxResponseBytes) {
    throw new Error("RESULT_LIMIT_EXCEEDED: Source response is too large");
  }
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
  const selected = resolvePointer(value, operation.rowsPointer);
  const rawRows = Array.isArray(selected)
    ? selected
    : selected === undefined
      ? []
      : [selected];
  const rows = rawRows
    .filter(
      (row): row is Record<string, unknown> =>
        Boolean(row) && typeof row === "object" && !Array.isArray(row),
    )
    .slice(0, 5_000);
  return {
    rows,
    meta: {
      columns: query.columns.length ? query.columns : inferColumns(rows),
      rowCount: rows.length,
      truncated: rawRows.length > rows.length,
      durationMs: Math.max(0, Math.round(performance.now() - started)),
      fetchedAt: new Date().toISOString(),
      cache: { hit: false },
    },
  };
}

async function testConnection(
  config: HttpDataSourceConfig,
  secretsRoot: string,
  signal?: AbortSignal,
): Promise<{ latencyMs: number }> {
  const started = performance.now();
  const url = await validateDestination(config);
  const timeout = AbortSignal.timeout(config.timeoutMs);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      accept: "application/json",
      ...(await authorization(config, secretsRoot)),
    },
    redirect: "error",
    signal: requestSignal,
  });
  if (!response.ok) {
    throw new Error(`CONNECTION_FAILED: HTTP ${response.status}`);
  }
  return { latencyMs: Math.max(0, Math.round(performance.now() - started)) };
}

export function createHttpConnector(secretsRoot: string): DataSourceConnector {
  return {
    kind: "http",
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
        validateConfig(context.config),
        secretsRoot,
        context.signal,
      );
    },
    async describe(context) {
      await validateDestination(validateConfig(context.config));
      return { entities: structuredClone(context.declaredEntities) };
    },
    execute(context) {
      return execute(
        validateConfig(context.config),
        context.query,
        context.parameters,
        secretsRoot,
        context.signal,
      );
    },
  };
}
