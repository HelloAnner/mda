ALTER TABLE agent_jobs
  DROP CONSTRAINT agent_jobs_purpose_check;

ALTER TABLE agent_jobs
  ADD CONSTRAINT agent_jobs_purpose_check
  CHECK (purpose IN ('edit', 'preview', 'publish')),
  ADD COLUMN source_checkpoint_id text REFERENCES draft_checkpoints(id),
  ADD COLUMN source_revision_id text REFERENCES dashboard_revisions(id);

CREATE TABLE dashboard_previews (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  dashboard_id text NOT NULL REFERENCES dashboards(id),
  job_id text NOT NULL REFERENCES agent_jobs(id),
  source_checkpoint_id text NOT NULL REFERENCES draft_checkpoints(id),
  source_revision_id text REFERENCES dashboard_revisions(id),
  source_digest text NOT NULL CHECK (source_digest ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'building'
    CHECK (status IN ('building', 'ready', 'failed', 'expired')),
  template_version text NOT NULL CHECK (template_version = '1'),
  runtime_version text NOT NULL CHECK (runtime_version = '1'),
  manifest_digest text CHECK (manifest_digest ~ '^[a-f0-9]{64}$'),
  build_digest text CHECK (build_digest ~ '^[a-f0-9]{64}$'),
  artifact_key text,
  file_count integer CHECK (file_count BETWEEN 1 AND 1000),
  total_bytes integer CHECK (total_bytes BETWEEN 1 AND 52428800),
  terminal_error jsonb,
  created_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  expires_at timestamptz NOT NULL,
  CHECK (
    (status = 'ready' AND manifest_digest IS NOT NULL AND build_digest IS NOT NULL
      AND artifact_key IS NOT NULL AND file_count IS NOT NULL
      AND total_bytes IS NOT NULL AND completed_at IS NOT NULL
      AND terminal_error IS NULL)
    OR
    (status = 'failed' AND artifact_key IS NULL AND completed_at IS NOT NULL
      AND terminal_error IS NOT NULL)
    OR
    (status IN ('building', 'expired'))
  )
);

CREATE INDEX dashboard_previews_list_idx
  ON dashboard_previews (tenant_id, dashboard_id, created_at DESC, id DESC);

CREATE UNIQUE INDEX dashboard_previews_one_pending_job_idx
  ON dashboard_previews (job_id)
  WHERE status = 'building';
