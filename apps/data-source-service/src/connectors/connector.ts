import type {
  DataEntity,
  DataSource,
  HttpDataSourceConfig,
  JdbcDataSourceConfig,
  QueryResult,
  RegisteredQuery,
} from "@mda/contracts";

export type DataSourceKind = DataSource["kind"];
export type ConnectorConfig = HttpDataSourceConfig | JdbcDataSourceConfig;
export type QueryParameters = Record<string, string | number | boolean | null>;
export type ConnectorQuery = Pick<
  RegisteredQuery,
  "operation" | "parameters" | "columns"
>;
export type CapabilitySupport = "native" | "emulated" | "unsupported";

export interface ConnectorCapabilities {
  schema: "native" | "declared" | "inferred";
  snapshotRead: "native";
  incrementalRead: CapabilitySupport;
  mutations: {
    insert: CapabilitySupport;
    update: CapabilitySupport;
    delete: CapabilitySupport;
  };
}

export interface ConnectorContext {
  sourceId: string;
  config: unknown;
  signal?: AbortSignal;
}

export interface ConnectorSchema {
  entities: DataEntity[];
}

export interface ConnectorConnectionTest {
  latencyMs: number;
}

export type ConnectorChange =
  | {
      type: "upsert";
      key: Record<string, unknown>;
      row: Record<string, unknown>;
    }
  | { type: "delete"; key: Record<string, unknown> };

export interface ConnectorChangePage {
  changes: ConnectorChange[];
  cursor?: string;
  hasMore: boolean;
}

export interface DataSourceConnector {
  readonly kind: DataSourceKind;
  readonly capabilities: ConnectorCapabilities;

  validateConfig(config: unknown): ConnectorConfig;
  testConnection(context: ConnectorContext): Promise<ConnectorConnectionTest>;
  describe(
    context: ConnectorContext & { declaredEntities: DataEntity[] },
  ): Promise<ConnectorSchema>;
  execute(
    context: ConnectorContext & {
      query: ConnectorQuery;
      parameters: QueryParameters;
    },
  ): Promise<QueryResult>;
  readChanges?(
    context: ConnectorContext & {
      query: ConnectorQuery;
      parameters: QueryParameters;
      cursor?: string;
    },
  ): Promise<ConnectorChangePage>;
  release?(sourceId: string): Promise<void>;
}

function connectorError(code: string, message: string): Error {
  return new Error(`${code}: ${message}`);
}

function valueMatches(type: string, value: unknown): boolean {
  if (value === null) return true;
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") {
    return typeof value === "number" && Number.isFinite(value);
  }
  if (type === "boolean") return typeof value === "boolean";
  return typeof value === "string";
}

export function validateParameters(
  query: ConnectorQuery,
  parameters: QueryParameters,
): void {
  for (const definition of query.parameters) {
    const value = parameters[definition.name];
    if (value === undefined && definition.required) {
      throw connectorError("PARAMETER_INVALID", `Missing ${definition.name}`);
    }
    if (value !== undefined && !valueMatches(definition.type, value)) {
      throw connectorError("PARAMETER_INVALID", `Invalid ${definition.name}`);
    }
  }
  if (
    Object.keys(parameters).some(
      (name) =>
        !query.parameters.some((definition) => definition.name === name),
    )
  ) {
    throw connectorError("PARAMETER_INVALID", "Unknown parameter");
  }
}

export class ConnectorRegistry {
  private readonly connectors = new Map<DataSourceKind, DataSourceConnector>();

  constructor(connectors: Iterable<DataSourceConnector>) {
    for (const connector of connectors) {
      if (this.connectors.has(connector.kind)) {
        throw new Error(`Duplicate Data Source connector: ${connector.kind}`);
      }
      if (
        connector.capabilities.incrementalRead !== "unsupported" &&
        !connector.readChanges
      ) {
        throw new Error(
          `Connector ${connector.kind} advertises incremental reads without implementing them`,
        );
      }
      this.connectors.set(connector.kind, connector);
    }
  }

  private get(kind: DataSourceKind): DataSourceConnector {
    const connector = this.connectors.get(kind);
    if (!connector) {
      throw connectorError(
        "CONNECTOR_UNAVAILABLE",
        `No connector is registered for ${kind}`,
      );
    }
    return connector;
  }

  capabilities(kind: DataSourceKind): ConnectorCapabilities {
    return this.get(kind).capabilities;
  }

  validateConfig(kind: DataSourceKind, config: unknown): ConnectorConfig {
    return this.get(kind).validateConfig(config);
  }

  testConnection(
    kind: DataSourceKind,
    context: ConnectorContext,
  ): Promise<ConnectorConnectionTest> {
    return this.get(kind).testConnection(context);
  }

  describe(
    kind: DataSourceKind,
    context: ConnectorContext & { declaredEntities: DataEntity[] },
  ): Promise<ConnectorSchema> {
    return this.get(kind).describe(context);
  }

  execute(
    kind: DataSourceKind,
    context: ConnectorContext & {
      query: ConnectorQuery;
      parameters: QueryParameters;
    },
  ): Promise<QueryResult> {
    return this.get(kind).execute(context);
  }

  async readChanges(
    kind: DataSourceKind,
    context: ConnectorContext & {
      query: ConnectorQuery;
      parameters: QueryParameters;
      cursor?: string;
    },
  ): Promise<ConnectorChangePage> {
    const connector = this.get(kind);
    if (
      connector.capabilities.incrementalRead === "unsupported" ||
      !connector.readChanges
    ) {
      throw connectorError(
        "CONNECTOR_CAPABILITY_UNSUPPORTED",
        `${kind} does not support incremental reads`,
      );
    }
    return await connector.readChanges(context);
  }

  async release(kind: DataSourceKind, sourceId: string): Promise<void> {
    await this.get(kind).release?.(sourceId);
  }
}
