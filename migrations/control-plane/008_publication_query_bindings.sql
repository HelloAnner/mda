CREATE TABLE publication_query_bindings (
  publication_id text NOT NULL REFERENCES publications(id),
  logical_name text NOT NULL,
  query_id text NOT NULL,
  query_revision integer NOT NULL CHECK (query_revision > 0),
  public_execution boolean NOT NULL DEFAULT false,
  parameters jsonb NOT NULL,
  PRIMARY KEY (publication_id, logical_name),
  UNIQUE (publication_id, query_id)
);

CREATE INDEX publication_query_bindings_query_idx
  ON publication_query_bindings (query_id, query_revision);
