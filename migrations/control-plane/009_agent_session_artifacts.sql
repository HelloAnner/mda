ALTER TABLE agent_sessions
  ADD COLUMN session_artifact_digest text
    CHECK (session_artifact_digest ~ '^[a-f0-9]{64}$'),
  ADD COLUMN session_artifact_bytes integer
    CHECK (session_artifact_bytes BETWEEN 1 AND 20971520);
