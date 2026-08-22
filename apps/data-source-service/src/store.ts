import { createHash } from "node:crypto";
import type {
  CreateDataSourceRequest,
  CreateRegisteredQueryRequest,
  DataEntity,
  DataSource,
  DataSourceDescription,
  DataSourceTestResult,
  ExecuteQueryRequest,
  HttpDataSourceConfig,
  JdbcDataSourceConfig,
  QueryResult,
  RegisteredQuery,
  RenameDataSourceRequest,
  UpdateDataSourceRequest,
} from "@mda/contracts";
import type { SQL } from "bun";
import {
  executeHttpQuery,
  inferColumns,
  testHttpSource,
} from "./http-connector.ts";
import {
  executeJdbcQuery,
  type JdbcConnectorConfig,
  testJdbcSource,
} from "./jdbc-connector.ts";

export class DataAccessError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

type Row = Record<string, unknown>;

function normalizedName(value: string): { name: string; normalized: string } {
  const name = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  return { name, normalized: name.toLocaleLowerCase("en-US") };
}

function json<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

function optionalIso(value: unknown): string | undefined {
  return value === null || value === undefined
    ? undefined
    : new Date(String(value)).toISOString();
}

function toSource(row: Row): DataSource {
  return {
    id: String(row.id),
    name: String(row.name),
    ...(row.description === null || row.description === undefined
      ? {}
      : { description: String(row.description) }),
    kind: row.kind as DataSource["kind"],
    status: row.status as DataSource["status"],
    health: row.health as DataSource["health"],
    configRevision: Number(row.latest_config_revision),
    ...(row.latest_schema_revision
      ? { schemaRevision: Number(row.latest_schema_revision) }
      : {}),
    version: Number(row.version),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
    ...(optionalIso(row.deleted_at)
      ? { deletedAt: optionalIso(row.deleted_at) }
      : {}),
  };
}

function toQuery(row: Row): RegisteredQuery {
  return {
    id: String(row.id),
    sourceId: String(row.source_id),
    name: String(row.name),
    ...(row.description === null || row.description === undefined
      ? {}
      : { description: String(row.description) }),
    revision: Number(row.revision),
    status: row.status as RegisteredQuery["status"],
    operation: json(row.operation),
    parameters: json(row.parameters),
    columns: json(row.columns),
    public: Boolean(row.public_execution),
    minRefreshIntervalMs: Number(row.min_refresh_interval_ms),
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function idempotency(
  transaction: SQL,
  tenantId: string,
  operation: string,
  key: string,
  request: unknown,
  resultId: string,
): Promise<string | undefined> {
  const requestDigest = digest(request);
  const rows = await transaction`
    INSERT INTO source_idempotency_keys (
      tenant_id, operation, key, request_digest, result_id
    ) VALUES (${tenantId}, ${operation}, ${key}, ${requestDigest}, ${resultId})
    ON CONFLICT (tenant_id, operation, key) DO NOTHING
    RETURNING result_id
  `;
  if (rows.length) return undefined;
  const existing = await transaction`
    SELECT request_digest, result_id FROM source_idempotency_keys
    WHERE tenant_id = ${tenantId} AND operation = ${operation} AND key = ${key}
  `;
  const row = existing[0] as Row;
  if (row.request_digest !== requestDigest) {
    throw new DataAccessError(
      409,
      "IDEMPOTENCY_CONFLICT",
      "Idempotency key was reused with different input",
    );
  }
  return String(row.result_id);
}

async function record(
  transaction: SQL,
  input: {
    tenantId: string;
    actorId: string;
    requestId: string;
    type: string;
    aggregateId: string;
    data?: Record<string, unknown>;
  },
): Promise<void> {
  const now = new Date().toISOString();
  await transaction`
    INSERT INTO source_events (id, tenant_id, type, aggregate_id, data, created_at)
    VALUES (${`source-event_${crypto.randomUUID()}`}, ${input.tenantId},
      ${input.type}, ${input.aggregateId}, ${JSON.stringify(input.data ?? {})}::jsonb,
      ${now})
  `;
  await transaction`
    INSERT INTO source_audit_events (
      id, tenant_id, actor_id, action, aggregate_id, request_id, data, created_at
    ) VALUES (${`source-audit_${crypto.randomUUID()}`}, ${input.tenantId},
      ${input.actorId}, ${input.type}, ${input.aggregateId}, ${input.requestId},
      ${JSON.stringify(input.data ?? {})}::jsonb, ${now})
  `;
}

const sourceColumns = `
  id, name, description, kind, status, health, latest_config_revision,
  latest_schema_revision, version, created_at, updated_at, deleted_at
`;

export async function createSource(
  db: SQL,
  tenantId: string,
  actorId: string,
  requestId: string,
  key: string,
  input: CreateDataSourceRequest,
): Promise<{ source: DataSource; created: boolean }> {
  const id = `source_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const name = normalizedName(input.name);
  try {
    return await db.begin(async (transaction) => {
      const replayId = await idempotency(
        transaction,
        tenantId,
        "data-source.create",
        key,
        input,
        id,
      );
      if (replayId) {
        const rows = await transaction.unsafe(
          `SELECT ${sourceColumns} FROM data_sources WHERE tenant_id = $1 AND id = $2`,
          [tenantId, replayId],
        );
        return { source: toSource(rows[0] as Row), created: false };
      }
      const rows = await transaction`
        INSERT INTO data_sources (
          id, tenant_id, name, normalized_name, description, kind, status,
          health, latest_config_revision, version, created_by, created_at, updated_at
        ) VALUES (${id}, ${tenantId}, ${name.name}, ${name.normalized},
          ${input.description?.trim() || null}, ${input.kind}, 'draft', 'unknown', 1, 1,
          ${actorId}, ${now}, ${now})
        RETURNING id, name, description, kind, status, health,
          latest_config_revision, latest_schema_revision, version,
          created_at, updated_at, deleted_at
      `;
      await transaction`
        INSERT INTO data_source_config_revisions (
          source_id, revision, config, entities, state, created_by, created_at
        ) VALUES (${id}, 1, ${JSON.stringify(input.config)}::jsonb,
          ${JSON.stringify(input.entities ?? [])}::jsonb, 'draft', ${actorId}, ${now})
      `;
      await record(transaction, {
        tenantId,
        actorId,
        requestId,
        type: "data-source.created",
        aggregateId: id,
      });
      return { source: toSource(rows[0] as Row), created: true };
    });
  } catch (error) {
    if ((error as { errno?: string }).errno === "23505") {
      throw new DataAccessError(
        409,
        "DATA_SOURCE_NAME_CONFLICT",
        "Data Source name already exists",
      );
    }
    throw error;
  }
}

export async function listSources(
  db: SQL,
  tenantId: string,
  limit: number,
): Promise<DataSource[]> {
  const rows = await db.unsafe(
    `SELECT ${sourceColumns} FROM data_sources
     WHERE tenant_id = $1 ORDER BY updated_at DESC, id DESC LIMIT $2`,
    [tenantId, limit],
  );
  return [...rows].map((row) => toSource(row as Row));
}

export async function getSource(
  db: SQL,
  tenantId: string,
  id: string,
): Promise<DataSource | undefined> {
  const rows = await db.unsafe(
    `SELECT ${sourceColumns} FROM data_sources WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id],
  );
  const row = rows[0] as Row | undefined;
  return row ? toSource(row) : undefined;
}

async function sourceConfig(
  db: SQL,
  tenantId: string,
  id: string,
  activeOnly = false,
): Promise<{
  source: DataSource;
  config: HttpDataSourceConfig | JdbcDataSourceConfig;
  entities: DataEntity[];
  state: string;
}> {
  const rows = await db`
    SELECT s.id, s.name, s.description, s.kind, s.status, s.health,
      s.latest_config_revision, s.latest_schema_revision, s.version,
      s.created_at, s.updated_at, s.deleted_at, c.config, c.entities, c.state
    FROM data_sources s
    JOIN data_source_config_revisions c
      ON c.source_id = s.id
     AND c.revision = ${activeOnly ? db`COALESCE(s.active_config_revision, -1)` : db`s.latest_config_revision`}
    WHERE s.tenant_id = ${tenantId} AND s.id = ${id}
  `;
  const row = rows[0] as Row | undefined;
  if (!row) {
    throw new DataAccessError(
      404,
      "DATA_SOURCE_NOT_FOUND",
      "Data Source not found",
    );
  }
  return {
    source: toSource(row),
    config: json(row.config),
    entities: json(row.entities),
    state: String(row.state),
  };
}

export async function describeSource(
  db: SQL,
  tenantId: string,
  id: string,
): Promise<DataSourceDescription> {
  const value = await sourceConfig(db, tenantId, id);
  return {
    source: value.source,
    runtime: {
      live: true,
      modes: ["query", "poll"],
      minRefreshIntervalMs: 5_000,
    },
    entities: value.entities,
  };
}

export async function renameSource(
  db: SQL,
  tenantId: string,
  actorId: string,
  requestId: string,
  id: string,
  input: RenameDataSourceRequest,
): Promise<DataSource> {
  const name = normalizedName(input.name);
  try {
    return await db.begin(async (transaction) => {
      const rows = await transaction`
        UPDATE data_sources SET name = ${name.name}, normalized_name = ${name.normalized},
          version = version + 1, updated_at = now()
        WHERE tenant_id = ${tenantId} AND id = ${id}
          AND version = ${input.expectedVersion} AND status <> 'deleted'
        RETURNING id, name, description, kind, status, health,
          latest_config_revision, latest_schema_revision, version,
          created_at, updated_at, deleted_at
      `;
      if (!rows.length) {
        throw new DataAccessError(
          409,
          "VERSION_CONFLICT",
          "Data Source changed or is unavailable",
        );
      }
      await record(transaction, {
        tenantId,
        actorId,
        requestId,
        type: "data-source.renamed",
        aggregateId: id,
      });
      return toSource(rows[0] as Row);
    });
  } catch (error) {
    if ((error as { errno?: string }).errno === "23505") {
      throw new DataAccessError(
        409,
        "DATA_SOURCE_NAME_CONFLICT",
        "Data Source name already exists",
      );
    }
    throw error;
  }
}

export async function updateSource(
  db: SQL,
  tenantId: string,
  actorId: string,
  requestId: string,
  id: string,
  input: UpdateDataSourceRequest,
): Promise<DataSource> {
  return db.begin(async (transaction) => {
    const existing = await sourceConfig(transaction, tenantId, id);
    if (existing.source.version !== input.expectedVersion) {
      throw new DataAccessError(409, "VERSION_CONFLICT", "Data Source changed");
    }
    const createsRevision = Boolean(input.config || input.entities);
    const revision = existing.source.configRevision + (createsRevision ? 1 : 0);
    if (createsRevision) {
      await transaction`
        INSERT INTO data_source_config_revisions (
          source_id, revision, config, entities, state, created_by, created_at
        ) VALUES (${id}, ${revision},
          ${JSON.stringify(input.config ?? existing.config)}::jsonb,
          ${JSON.stringify(input.entities ?? existing.entities)}::jsonb,
          'draft', ${actorId}, now())
      `;
    }
    const rows = await transaction`
      UPDATE data_sources
      SET description = ${input.description === undefined ? (existing.source.description ?? null) : input.description.trim() || null},
        latest_config_revision = ${revision}, version = version + 1,
        updated_at = now(), health = ${createsRevision ? "unknown" : existing.source.health}
      WHERE tenant_id = ${tenantId} AND id = ${id}
        AND version = ${input.expectedVersion}
      RETURNING id, name, description, kind, status, health,
        latest_config_revision, latest_schema_revision, version,
        created_at, updated_at, deleted_at
    `;
    if (!rows.length) {
      throw new DataAccessError(409, "VERSION_CONFLICT", "Data Source changed");
    }
    await record(transaction, {
      tenantId,
      actorId,
      requestId,
      type: "data-source.updated",
      aggregateId: id,
      data: { configRevision: revision },
    });
    return toSource(rows[0] as Row);
  });
}

export async function testSource(
  db: SQL,
  jdbc: JdbcConnectorConfig,
  tenantId: string,
  actorId: string,
  requestId: string,
  id: string,
): Promise<DataSourceTestResult> {
  const value = await sourceConfig(db, tenantId, id);
  const checkedAt = new Date().toISOString();
  try {
    const { latencyMs } =
      value.source.kind === "jdbc"
        ? await testJdbcSource(jdbc, value.config as JdbcDataSourceConfig)
        : await testHttpSource(value.config as HttpDataSourceConfig);
    const result: DataSourceTestResult = {
      sourceId: id,
      configRevision: value.source.configRevision,
      success: true,
      health: "healthy",
      latencyMs,
      checkedAt,
      message: "Connection succeeded",
    };
    await db.begin(async (transaction) => {
      await transaction`
        UPDATE data_source_config_revisions
        SET state = 'tested', tested_at = ${checkedAt},
          test_result = ${JSON.stringify(result)}::jsonb
        WHERE source_id = ${id} AND revision = ${value.source.configRevision}
      `;
      await transaction`
        UPDATE data_sources SET health = 'healthy', updated_at = now()
        WHERE tenant_id = ${tenantId} AND id = ${id}
      `;
      await record(transaction, {
        tenantId,
        actorId,
        requestId,
        type: "data-source.config-tested",
        aggregateId: id,
        data: { success: true, configRevision: value.source.configRevision },
      });
    });
    return result;
  } catch (error) {
    const result: DataSourceTestResult = {
      sourceId: id,
      configRevision: value.source.configRevision,
      success: false,
      health: "unreachable",
      latencyMs: 0,
      checkedAt,
      message:
        error instanceof Error
          ? error.message.slice(0, 2_000)
          : "Connection failed",
    };
    await db`
      UPDATE data_sources SET health = 'unreachable', updated_at = now()
      WHERE tenant_id = ${tenantId} AND id = ${id}
    `;
    return result;
  }
}

export async function activateSource(
  db: SQL,
  tenantId: string,
  actorId: string,
  requestId: string,
  id: string,
): Promise<DataSource> {
  return db.begin(async (transaction) => {
    const rows = await transaction`
      SELECT latest_config_revision FROM data_sources
      WHERE tenant_id = ${tenantId} AND id = ${id} AND status <> 'deleted'
      FOR UPDATE
    `;
    const source = rows[0] as Row | undefined;
    if (!source) {
      throw new DataAccessError(
        404,
        "DATA_SOURCE_NOT_FOUND",
        "Data Source not found",
      );
    }
    const revision = Number(source.latest_config_revision);
    const configs = await transaction`
      SELECT state FROM data_source_config_revisions
      WHERE source_id = ${id} AND revision = ${revision}
    `;
    if ((configs[0] as Row | undefined)?.state !== "tested") {
      throw new DataAccessError(
        409,
        "CONFIG_NOT_TESTED",
        "Latest configuration must pass a connection test",
      );
    }
    await transaction`
      UPDATE data_source_config_revisions SET state = 'active', activated_at = now()
      WHERE source_id = ${id} AND revision = ${revision}
    `;
    const updated = await transaction`
      UPDATE data_sources SET active_config_revision = ${revision}, status = 'active',
        health = 'healthy', version = version + 1, updated_at = now()
      WHERE tenant_id = ${tenantId} AND id = ${id}
      RETURNING id, name, description, kind, status, health,
        latest_config_revision, latest_schema_revision, version,
        created_at, updated_at, deleted_at
    `;
    await record(transaction, {
      tenantId,
      actorId,
      requestId,
      type: "data-source.config-activated",
      aggregateId: id,
      data: { configRevision: revision },
    });
    return toSource(updated[0] as Row);
  });
}

export async function transitionSource(
  db: SQL,
  tenantId: string,
  actorId: string,
  requestId: string,
  id: string,
  action: "enable" | "disable" | "delete" | "restore",
): Promise<DataSource> {
  const target = {
    enable: "active",
    disable: "disabled",
    delete: "deleted",
    restore: "disabled",
  }[action];
  return db.begin(async (transaction) => {
    const rows = await transaction`
      UPDATE data_sources SET status = ${target}, version = version + 1,
        updated_at = now(),
        deleted_at = ${action === "delete" ? new Date().toISOString() : action === "restore" ? null : db`deleted_at`}
      WHERE tenant_id = ${tenantId} AND id = ${id}
        AND (${action === "restore" ? db`status = 'deleted'` : db`status <> 'deleted'`})
        AND (${action === "enable" ? db`active_config_revision IS NOT NULL` : db`TRUE`})
      RETURNING id, name, description, kind, status, health,
        latest_config_revision, latest_schema_revision, version,
        created_at, updated_at, deleted_at
    `;
    if (!rows.length) {
      throw new DataAccessError(
        409,
        "DATA_SOURCE_STATE_CONFLICT",
        "Data Source cannot transition",
      );
    }
    const source = toSource(rows[0] as Row);
    await record(transaction, {
      tenantId,
      actorId,
      requestId,
      type: `data-source.${action === "delete" ? "deleted" : action === "restore" ? "restored" : `${action}d`}`,
      aggregateId: id,
    });
    return source;
  });
}

export async function refreshSchema(
  db: SQL,
  tenantId: string,
  actorId: string,
  requestId: string,
  id: string,
): Promise<DataSourceDescription> {
  const value = await sourceConfig(db, tenantId, id, true);
  const revision = (value.source.schemaRevision ?? 0) + 1;
  await db.begin(async (transaction) => {
    await transaction`
      INSERT INTO data_source_schema_revisions (
        source_id, revision, entities, digest, created_at
      ) VALUES (${id}, ${revision}, ${JSON.stringify(value.entities)}::jsonb,
        ${digest(value.entities)}, now())
    `;
    await transaction`
      UPDATE data_sources SET latest_schema_revision = ${revision},
        version = version + 1, updated_at = now()
      WHERE tenant_id = ${tenantId} AND id = ${id}
    `;
    await record(transaction, {
      tenantId,
      actorId,
      requestId,
      type: "data-source.schema-refreshed",
      aggregateId: id,
      data: { schemaRevision: revision },
    });
  });
  return describeSource(db, tenantId, id);
}

async function activeQueryRows(
  db: SQL,
  tenantId: string,
  queryId?: string,
  sourceId?: string,
) {
  return db`
    SELECT q.id, q.source_id, q.name, r.description, r.revision,
      q.status, r.operation, r.parameters, r.columns, r.public_execution,
      r.min_refresh_interval_ms, r.created_at
    FROM registered_queries q
    JOIN query_revisions r ON r.query_id = q.id AND r.revision = q.active_revision
    WHERE q.tenant_id = ${tenantId}
      AND (${queryId ?? null}::text IS NULL OR q.id = ${queryId ?? null})
      AND (${sourceId ?? null}::text IS NULL OR q.source_id = ${sourceId ?? null})
    ORDER BY q.created_at DESC, q.id DESC
  `;
}

export async function registerQuery(
  db: SQL,
  jdbc: JdbcConnectorConfig,
  tenantId: string,
  actorId: string,
  requestId: string,
  key: string,
  input: CreateRegisteredQueryRequest,
): Promise<{ query: RegisteredQuery; created: boolean }> {
  const source = await sourceConfig(db, tenantId, input.sourceId, true);
  if (source.source.status !== "active") {
    throw new DataAccessError(
      409,
      "DATA_SOURCE_DISABLED",
      "Data Source is not active",
    );
  }
  const preliminary: Pick<
    RegisteredQuery,
    "operation" | "parameters" | "columns"
  > = {
    operation: input.operation,
    parameters: input.parameters,
    columns: [],
  };
  const result =
    source.source.kind === "jdbc"
      ? await executeJdbcQuery(
          jdbc,
          source.config as JdbcDataSourceConfig,
          preliminary,
          input.sampleParameters ?? {},
        )
      : await executeHttpQuery(
          source.config as HttpDataSourceConfig,
          preliminary,
          input.sampleParameters ?? {},
        );
  const columns = result.meta.columns.length
    ? result.meta.columns
    : inferColumns(result.rows);
  const id = `query_${crypto.randomUUID()}`;
  const name = normalizedName(input.name);
  const now = new Date().toISOString();
  try {
    return await db.begin(async (transaction) => {
      const replayId = await idempotency(
        transaction,
        tenantId,
        "query.create",
        key,
        input,
        id,
      );
      if (replayId) {
        const rows = await activeQueryRows(transaction, tenantId, replayId);
        return { query: toQuery(rows[0] as Row), created: false };
      }
      await transaction`
        INSERT INTO registered_queries (
          id, tenant_id, source_id, name, normalized_name, latest_revision,
          active_revision, status, created_by, created_at
        ) VALUES (${id}, ${tenantId}, ${input.sourceId}, ${name.name},
          ${name.normalized}, 1, 1, 'active', ${actorId}, ${now})
      `;
      const rows = await transaction`
        INSERT INTO query_revisions (
          query_id, revision, source_config_revision, description, operation,
          parameters, columns, public_execution, min_refresh_interval_ms,
          status, created_by, created_at
        ) VALUES (${id}, 1, ${source.source.configRevision},
          ${input.description?.trim() || null}, ${JSON.stringify(input.operation)}::jsonb,
          ${JSON.stringify(input.parameters)}::jsonb, ${JSON.stringify(columns)}::jsonb,
          ${input.public ?? false}, ${input.minRefreshIntervalMs ?? 5_000},
          'active', ${actorId}, ${now})
        RETURNING ${id}::text AS id, ${input.sourceId}::text AS source_id,
          ${name.name}::text AS name, description, revision, status, operation,
          parameters, columns, public_execution, min_refresh_interval_ms, created_at
      `;
      await record(transaction, {
        tenantId,
        actorId,
        requestId,
        type: "query.created",
        aggregateId: id,
        data: { sourceId: input.sourceId, revision: 1 },
      });
      return { query: toQuery(rows[0] as Row), created: true };
    });
  } catch (error) {
    if ((error as { errno?: string }).errno === "23505") {
      throw new DataAccessError(
        409,
        "QUERY_NAME_CONFLICT",
        "Query name already exists",
      );
    }
    throw error;
  }
}

export async function listQueries(
  db: SQL,
  tenantId: string,
  sourceId?: string,
): Promise<RegisteredQuery[]> {
  return [...(await activeQueryRows(db, tenantId, undefined, sourceId))].map(
    (row) => toQuery(row as Row),
  );
}

export async function getQuery(
  db: SQL,
  tenantId: string,
  id: string,
): Promise<RegisteredQuery | undefined> {
  const rows = await activeQueryRows(db, tenantId, id);
  return rows[0] ? toQuery(rows[0] as Row) : undefined;
}

export async function executeQuery(
  db: SQL,
  jdbc: JdbcConnectorConfig,
  tenantId: string,
  actorId: string,
  id: string,
  input: ExecuteQueryRequest,
  publicExecution = false,
): Promise<QueryResult> {
  const query = await getQuery(db, tenantId, id);
  if (!query || (input.revision && input.revision !== query.revision)) {
    throw new DataAccessError(
      404,
      "QUERY_NOT_FOUND",
      "Query Revision not found",
    );
  }
  if (query.status !== "active" || (publicExecution && !query.public)) {
    throw new DataAccessError(
      403,
      "FORBIDDEN",
      "Query execution is not allowed",
    );
  }
  const source = await sourceConfig(db, tenantId, query.sourceId, true);
  if (source.source.status !== "active") {
    throw new DataAccessError(
      409,
      "DATA_SOURCE_DISABLED",
      "Data Source is not active",
    );
  }
  const started = performance.now();
  try {
    const result =
      source.source.kind === "jdbc"
        ? await executeJdbcQuery(
            jdbc,
            source.config as JdbcDataSourceConfig,
            query,
            input.parameters,
          )
        : await executeHttpQuery(
            source.config as HttpDataSourceConfig,
            query,
            input.parameters,
          );
    await db`
      INSERT INTO query_execution_audit (
        id, tenant_id, actor_id, query_id, query_revision, row_count,
        duration_ms, success, created_at
      ) VALUES (${`execution_${crypto.randomUUID()}`}, ${tenantId}, ${actorId},
        ${id}, ${query.revision}, ${result.meta.rowCount}, ${result.meta.durationMs},
        TRUE, now())
    `;
    return result;
  } catch (error) {
    await db`
      INSERT INTO query_execution_audit (
        id, tenant_id, actor_id, query_id, query_revision, row_count,
        duration_ms, success, error_code, created_at
      ) VALUES (${`execution_${crypto.randomUUID()}`}, ${tenantId}, ${actorId},
        ${id}, ${query.revision}, 0,
        ${Math.max(0, Math.round(performance.now() - started))}, FALSE,
        'EXECUTION_FAILED', now())
    `;
    throw error;
  }
}
