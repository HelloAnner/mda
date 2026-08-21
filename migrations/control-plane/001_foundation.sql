CREATE TABLE tenants (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id text PRIMARY KEY,
  oidc_issuer text NOT NULL,
  oidc_subject text NOT NULL,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (oidc_issuer, oidc_subject)
);

CREATE TABLE memberships (
  tenant_id text NOT NULL REFERENCES tenants(id),
  user_id text NOT NULL REFERENCES users(id),
  permissions text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE dashboards (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  normalized_name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (tenant_id, normalized_name)
);

CREATE INDEX dashboards_tenant_updated_idx
  ON dashboards (tenant_id, updated_at DESC, id DESC);

CREATE TABLE control_idempotency_keys (
  tenant_id text NOT NULL REFERENCES tenants(id),
  operation text NOT NULL,
  key text NOT NULL,
  request_digest text NOT NULL,
  result_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, operation, key)
);

CREATE TABLE control_outbox (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  event_type text NOT NULL,
  aggregate_id text NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  delivered_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0)
);

CREATE INDEX control_outbox_pending_idx
  ON control_outbox (occurred_at)
  WHERE delivered_at IS NULL;

CREATE TABLE audit_events (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  actor_id text NOT NULL REFERENCES users(id),
  action text NOT NULL,
  aggregate_id text NOT NULL,
  request_id text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL
);

CREATE INDEX audit_events_tenant_time_idx
  ON audit_events (tenant_id, occurred_at DESC);
