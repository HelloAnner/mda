import { lookup } from "node:dns/promises";
import type {
  HttpDataSourceConfig,
  HttpQueryOperation,
  QueryResult,
  RegisteredQuery,
} from "@mda/contracts";

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
  const url = new URL(config.baseUrl);
  if (url.username || url.password) {
    throw new Error("CONFIG_INVALID: URL credentials are forbidden");
  }
  if (url.protocol !== "https:" && !config.allowPrivateNetwork) {
    throw new Error("HTTP_DESTINATION_BLOCKED: HTTPS is required");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("HTTP_DESTINATION_BLOCKED: Unsupported URL protocol");
  }
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

function valueMatches(type: string, value: unknown): boolean {
  if (value === null) return true;
  if (type === "integer") return Number.isInteger(value);
  if (type === "number")
    return typeof value === "number" && Number.isFinite(value);
  if (type === "boolean") return typeof value === "boolean";
  return typeof value === "string";
}

function inferType(
  value: unknown,
): "string" | "integer" | "number" | "boolean" | "json" {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number")
    return Number.isInteger(value) ? "integer" : "number";
  if (typeof value === "string") return "string";
  return "json";
}

export function inferColumns(rows: Array<Record<string, unknown>>) {
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

export async function executeHttpQuery(
  config: HttpDataSourceConfig,
  query: Pick<RegisteredQuery, "operation" | "parameters" | "columns">,
  parameters: Record<string, string | number | boolean | null>,
  signal?: AbortSignal,
): Promise<QueryResult> {
  const started = performance.now();
  const base = await validateDestination(config);
  const operation = query.operation as HttpQueryOperation;
  for (const definition of query.parameters) {
    const value = parameters[definition.name];
    if (value === undefined && definition.required) {
      throw new Error(`PARAMETER_INVALID: Missing ${definition.name}`);
    }
    if (value !== undefined && !valueMatches(definition.type, value)) {
      throw new Error(`PARAMETER_INVALID: Invalid ${definition.name}`);
    }
  }
  if (
    Object.keys(parameters).some(
      (name) =>
        !query.parameters.some((definition) => definition.name === name),
    )
  ) {
    throw new Error("PARAMETER_INVALID: Unknown parameter");
  }
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

export async function testHttpSource(
  config: HttpDataSourceConfig,
): Promise<{ latencyMs: number }> {
  const started = performance.now();
  const url = await validateDestination(config);
  const response = await fetch(url, {
    method: "GET",
    headers: { accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!response.ok)
    throw new Error(`CONNECTION_FAILED: HTTP ${response.status}`);
  return { latencyMs: Math.max(0, Math.round(performance.now() - started)) };
}
