CREATE TABLE agent_sessions (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  dashboard_id text NOT NULL REFERENCES dashboards(id),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  pi_session_id text,
  session_artifact_key text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX agent_sessions_dashboard_updated_idx
  ON agent_sessions (tenant_id, dashboard_id, updated_at DESC);

CREATE TABLE agent_jobs (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  dashboard_id text NOT NULL REFERENCES dashboards(id),
  session_id text NOT NULL REFERENCES agent_sessions(id),
  purpose text NOT NULL DEFAULT 'edit' CHECK (purpose IN ('edit', 'publish')),
  prompt_text text NOT NULL CHECK (length(prompt_text) BETWEEN 1 AND 20000),
  state text NOT NULL CHECK (
    state IN ('queued', 'leased', 'running', 'succeeded', 'failed', 'cancelled')
  ),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  lease_owner text,
  fencing_token bigint NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
  lease_expires_at timestamptz,
  cancellation_requested_at timestamptz,
  terminal_error jsonb,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL,
  started_at timestamptz,
  finished_at timestamptz,
  CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL)),
  CHECK (
    (state IN ('leased', 'running') AND lease_owner IS NOT NULL) OR
    (state NOT IN ('leased', 'running') AND lease_owner IS NULL)
  )
);

CREATE INDEX agent_jobs_queue_idx
  ON agent_jobs (created_at, id)
  WHERE state = 'queued';

CREATE INDEX agent_jobs_session_idx
  ON agent_jobs (tenant_id, session_id, created_at DESC);

CREATE UNIQUE INDEX agent_jobs_one_active_per_session_idx
  ON agent_jobs (session_id)
  WHERE state IN ('queued', 'leased', 'running');

CREATE INDEX agent_jobs_expired_lease_idx
  ON agent_jobs (lease_expires_at)
  WHERE state IN ('leased', 'running');
