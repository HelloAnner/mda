import { createHash } from "node:crypto";
import type {
  AgentLeaseCommand,
  AgentSessionArtifact,
  UploadAgentSessionArtifactResponse,
} from "@mda/contracts";
import type { SQL } from "bun";
import type { ArtifactStore } from "../../shared/artifacts.ts";
import { HttpError } from "../../shared/http.ts";
import { authorizeAgentJobLease } from "./postgres.ts";

function decode(artifact: AgentSessionArtifact): Uint8Array {
  const bytes = Buffer.from(artifact.content, "base64");
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (
    bytes.toString("base64") !== artifact.content ||
    bytes.length !== artifact.bytes ||
    digest !== artifact.digest
  ) {
    throw new HttpError(
      400,
      "INVALID_SESSION_ARTIFACT",
      "Agent Session artifact is inconsistent",
    );
  }
  return bytes;
}

export async function storeAgentSessionArtifact(
  db: SQL,
  artifacts: ArtifactStore,
  jobId: string,
  command: AgentLeaseCommand,
  artifact: AgentSessionArtifact,
): Promise<UploadAgentSessionArtifactResponse> {
  const bytes = decode(artifact);
  const principal = await authorizeAgentJobLease(db, jobId, command);
  const rows = await db`
    SELECT session_id FROM agent_jobs WHERE id = ${jobId} LIMIT 1
  `;
  const sessionId = String(rows[0]?.session_id);
  const key = `agent-sessions/${encodeURIComponent(principal.tenantId)}/${encodeURIComponent(sessionId)}/${artifact.digest}.jsonl`;
  try {
    await artifacts.write(key, bytes, "application/x-ndjson");
  } catch {
    throw new HttpError(
      503,
      "ARTIFACT_UNAVAILABLE",
      "Agent Session artifact could not be stored",
      true,
    );
  }
  await db`
    UPDATE agent_sessions
    SET session_artifact_key = ${key}, session_artifact_digest = ${artifact.digest},
      session_artifact_bytes = ${artifact.bytes}, version = version + 1,
      updated_at = now()
    WHERE tenant_id = ${principal.tenantId} AND id = ${sessionId}
  `;
  return { digest: artifact.digest, bytes: artifact.bytes };
}

export async function loadAgentSessionArtifact(
  db: SQL,
  artifacts: ArtifactStore,
  jobId: string,
): Promise<AgentSessionArtifact | undefined> {
  const rows = await db`
    SELECT s.session_artifact_key, s.session_artifact_digest,
      s.session_artifact_bytes
    FROM agent_jobs j
    JOIN agent_sessions s ON s.id = j.session_id AND s.tenant_id = j.tenant_id
    WHERE j.id = ${jobId}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row?.session_artifact_key) return undefined;
  try {
    const bytes = await artifacts.read(String(row.session_artifact_key));
    const artifact: AgentSessionArtifact = {
      digest: String(row.session_artifact_digest),
      bytes: Number(row.session_artifact_bytes),
      content: Buffer.from(bytes).toString("base64"),
    };
    decode(artifact);
    return artifact;
  } catch {
    throw new HttpError(
      503,
      "ARTIFACT_UNAVAILABLE",
      "Agent Session history is unavailable",
      true,
    );
  }
}
