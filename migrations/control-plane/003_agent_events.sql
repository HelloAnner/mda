CREATE TABLE agent_events (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  job_id text NOT NULL REFERENCES agent_jobs(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence > 0),
  type text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL,
  UNIQUE (job_id, sequence)
);

CREATE INDEX agent_events_replay_idx
  ON agent_events (tenant_id, job_id, sequence);
