CREATE TABLE draft_checkpoints (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  dashboard_id text NOT NULL REFERENCES dashboards(id),
  session_id text NOT NULL REFERENCES agent_sessions(id),
  job_id text NOT NULL UNIQUE REFERENCES agent_jobs(id),
  parent_checkpoint_id text REFERENCES draft_checkpoints(id),
  artifact_key text NOT NULL,
  content_digest text NOT NULL CHECK (content_digest ~ '^[a-f0-9]{64}$'),
  file_count integer NOT NULL CHECK (file_count BETWEEN 1 AND 1000),
  total_bytes integer NOT NULL CHECK (total_bytes BETWEEN 0 AND 20971520),
  status text NOT NULL DEFAULT 'staged' CHECK (status IN ('staged', 'active')),
  created_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL
);

CREATE INDEX draft_checkpoints_latest_idx
  ON draft_checkpoints (tenant_id, dashboard_id, created_at DESC, id DESC)
  WHERE status = 'active';

CREATE TABLE dashboard_revisions (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  dashboard_id text NOT NULL REFERENCES dashboards(id),
  revision_number integer NOT NULL CHECK (revision_number > 0),
  checkpoint_id text NOT NULL UNIQUE REFERENCES draft_checkpoints(id),
  artifact_key text NOT NULL,
  content_digest text NOT NULL CHECK (content_digest ~ '^[a-f0-9]{64}$'),
  file_count integer NOT NULL CHECK (file_count BETWEEN 1 AND 1000),
  total_bytes integer NOT NULL CHECK (total_bytes BETWEEN 0 AND 20971520),
  message text CHECK (length(message) <= 500),
  created_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, dashboard_id, revision_number)
);

CREATE INDEX dashboard_revisions_list_idx
  ON dashboard_revisions (
    tenant_id, dashboard_id, revision_number DESC, id DESC
  );
