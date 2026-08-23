CREATE TABLE dashboard_folders (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  parent_id text REFERENCES dashboard_folders(id),
  name text NOT NULL,
  normalized_name text NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE UNIQUE INDEX dashboard_folders_root_name_idx
  ON dashboard_folders (tenant_id, normalized_name)
  WHERE parent_id IS NULL;

CREATE UNIQUE INDEX dashboard_folders_sibling_name_idx
  ON dashboard_folders (tenant_id, parent_id, normalized_name)
  WHERE parent_id IS NOT NULL;

CREATE INDEX dashboard_folders_tree_idx
  ON dashboard_folders (tenant_id, parent_id, name, id);

ALTER TABLE dashboards
  ADD COLUMN folder_id text REFERENCES dashboard_folders(id);

CREATE INDEX dashboards_folder_idx
  ON dashboards (tenant_id, folder_id, updated_at DESC, id DESC);
