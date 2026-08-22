CREATE TABLE publication_builds (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  dashboard_id text NOT NULL REFERENCES dashboards(id),
  revision_id text NOT NULL REFERENCES dashboard_revisions(id),
  checkpoint_id text NOT NULL REFERENCES draft_checkpoints(id),
  job_id text NOT NULL UNIQUE REFERENCES agent_jobs(id),
  source_digest text NOT NULL CHECK (source_digest ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'building'
    CHECK (status IN ('building', 'ready', 'failed')),
  publication_id text,
  terminal_error jsonb,
  requested_by text NOT NULL REFERENCES users(id),
  request_id text NOT NULL,
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  CHECK (
    (status = 'building' AND publication_id IS NULL
      AND terminal_error IS NULL AND completed_at IS NULL)
    OR
    (status = 'ready' AND publication_id IS NOT NULL
      AND terminal_error IS NULL AND completed_at IS NOT NULL)
    OR
    (status = 'failed' AND publication_id IS NULL
      AND terminal_error IS NOT NULL AND completed_at IS NOT NULL)
  )
);

CREATE INDEX publication_builds_list_idx
  ON publication_builds (tenant_id, dashboard_id, created_at DESC, id DESC);

CREATE TABLE publications (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  dashboard_id text NOT NULL REFERENCES dashboards(id),
  publication_number integer NOT NULL CHECK (publication_number > 0),
  revision_id text NOT NULL REFERENCES dashboard_revisions(id),
  build_id text NOT NULL UNIQUE REFERENCES publication_builds(id),
  source_digest text NOT NULL CHECK (source_digest ~ '^[a-f0-9]{64}$'),
  manifest_digest text NOT NULL CHECK (manifest_digest ~ '^[a-f0-9]{64}$'),
  build_digest text NOT NULL CHECK (build_digest ~ '^[a-f0-9]{64}$'),
  template_version text NOT NULL CHECK (template_version = '1'),
  runtime_version text NOT NULL CHECK (runtime_version = '1'),
  artifact_key text NOT NULL,
  file_count integer NOT NULL CHECK (file_count BETWEEN 1 AND 1000),
  total_bytes integer NOT NULL CHECK (total_bytes BETWEEN 1 AND 52428800),
  created_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, dashboard_id, publication_number)
);

ALTER TABLE publication_builds
  ADD CONSTRAINT publication_builds_publication_fk
  FOREIGN KEY (publication_id) REFERENCES publications(id);

CREATE INDEX publications_list_idx
  ON publications (
    tenant_id, dashboard_id, publication_number DESC, id DESC
  );
