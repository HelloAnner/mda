CREATE TABLE IF NOT EXISTS data_sources (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  name text NOT NULL,
  normalized_name text NOT NULL,
  description text,
  kind text NOT NULL CHECK (kind = 'http'),
  status text NOT NULL CHECK (status IN ('draft', 'active', 'disabled', 'deleted')),
  health text NOT NULL CHECK (health IN ('unknown', 'healthy', 'degraded', 'unreachable')),
  active_config_revision integer,
  latest_config_revision integer NOT NULL CHECK (latest_config_revision > 0),
  latest_schema_revision integer,
  version integer NOT NULL CHECK (version > 0),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  UNIQUE (tenant_id, normalized_name)
);

CREATE TABLE IF NOT EXISTS data_source_config_revisions (
  source_id text NOT NULL REFERENCES data_sources(id),
  revision integer NOT NULL CHECK (revision > 0),
  config jsonb NOT NULL,
  entities jsonb NOT NULL DEFAULT '[]',
  state text NOT NULL CHECK (state IN ('draft', 'tested', 'active', 'rejected')),
  tested_at timestamptz,
  test_result jsonb,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  activated_at timestamptz,
  PRIMARY KEY (source_id, revision)
);

CREATE TABLE IF NOT EXISTS data_source_schema_revisions (
  source_id text NOT NULL REFERENCES data_sources(id),
  revision integer NOT NULL CHECK (revision > 0),
  entities jsonb NOT NULL,
  digest text NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (source_id, revision)
);

CREATE TABLE IF NOT EXISTS registered_queries (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  source_id text NOT NULL REFERENCES data_sources(id),
  name text NOT NULL,
  normalized_name text NOT NULL,
  latest_revision integer NOT NULL CHECK (latest_revision > 0),
  active_revision integer,
  status text NOT NULL CHECK (status IN ('active', 'retired')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, normalized_name)
);

CREATE TABLE IF NOT EXISTS query_revisions (
  query_id text NOT NULL REFERENCES registered_queries(id),
  revision integer NOT NULL CHECK (revision > 0),
  source_config_revision integer NOT NULL CHECK (source_config_revision > 0),
  description text,
  operation jsonb NOT NULL,
  parameters jsonb NOT NULL,
  columns jsonb NOT NULL,
  public_execution boolean NOT NULL DEFAULT false,
  min_refresh_interval_ms integer NOT NULL CHECK (min_refresh_interval_ms >= 1000),
  status text NOT NULL CHECK (status IN ('active', 'retired')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (query_id, revision)
);

CREATE TABLE IF NOT EXISTS source_idempotency_keys (
  tenant_id text NOT NULL,
  operation text NOT NULL,
  key text NOT NULL,
  request_digest text NOT NULL,
  result_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, operation, key)
);

CREATE TABLE IF NOT EXISTS source_events (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  type text NOT NULL,
  aggregate_id text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS source_audit_events (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  actor_id text NOT NULL,
  action text NOT NULL,
  aggregate_id text NOT NULL,
  request_id text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS query_execution_audit (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  actor_id text NOT NULL,
  query_id text NOT NULL,
  query_revision integer NOT NULL,
  row_count integer NOT NULL,
  duration_ms integer NOT NULL,
  success boolean NOT NULL,
  error_code text,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS data_sources_list_idx
  ON data_sources (tenant_id, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS registered_queries_list_idx
  ON registered_queries (tenant_id, source_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS source_events_list_idx
  ON source_events (tenant_id, created_at DESC, id DESC);
