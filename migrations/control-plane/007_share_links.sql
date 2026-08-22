CREATE TABLE share_links (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  dashboard_id text NOT NULL REFERENCES dashboards(id),
  publication_id text NOT NULL REFERENCES publications(id),
  access_mode text NOT NULL CHECK (access_mode = 'public'),
  token_digest text NOT NULL UNIQUE CHECK (token_digest ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  expires_at timestamptz,
  created_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL,
  revoked_by text REFERENCES users(id),
  revoked_at timestamptz,
  CHECK (
    (status = 'active' AND revoked_by IS NULL AND revoked_at IS NULL)
    OR
    (status = 'revoked' AND revoked_by IS NOT NULL AND revoked_at IS NOT NULL)
  )
);

CREATE INDEX share_links_dashboard_idx
  ON share_links (tenant_id, dashboard_id, created_at DESC, id DESC);

CREATE INDEX share_links_publication_idx
  ON share_links (tenant_id, publication_id, created_at DESC, id DESC);
