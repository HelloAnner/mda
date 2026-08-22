import type {
  AgentWorkspaceRestore,
  CheckpointAgentWorkspaceRequest,
  CheckpointAgentWorkspaceResponse,
} from "@mda/contracts";
import type { SQL } from "bun";
import type { ArtifactStore } from "../../shared/artifacts.ts";
import { HttpError } from "../../shared/http.ts";
import {
  getAgentCheckpointContext,
  insertDraftCheckpoint,
  type RevisionRecord,
} from "./postgres.ts";
import {
  decodeSourceSnapshot,
  encodeSourceSnapshot,
  type ValidatedSnapshot,
  validateSourceSnapshot,
} from "./snapshot.ts";

function artifactKey(
  tenantId: string,
  dashboardId: string,
  digest: string,
): string {
  return `source-snapshots/${encodeURIComponent(tenantId)}/${encodeURIComponent(dashboardId)}/${digest}.json`;
}

function verifyMetadata(
  snapshot: ValidatedSnapshot,
  metadata: { digest: string; fileCount: number; totalBytes: number },
): void {
  if (
    snapshot.snapshot.digest !== metadata.digest ||
    snapshot.snapshot.fileCount !== metadata.fileCount ||
    snapshot.snapshot.totalBytes !== metadata.totalBytes
  ) {
    throw new Error("Artifact snapshot metadata is inconsistent");
  }
}

async function readSnapshot(
  artifacts: ArtifactStore,
  key: string,
): Promise<ValidatedSnapshot> {
  try {
    return decodeSourceSnapshot(await artifacts.read(key));
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "artifact.read.failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    throw new HttpError(
      503,
      "ARTIFACT_UNAVAILABLE",
      "Dashboard source artifact is unavailable",
      true,
    );
  }
}

export async function loadAgentWorkspace(
  db: SQL,
  artifacts: ArtifactStore,
  jobId: string,
): Promise<AgentWorkspaceRestore | undefined> {
  const context = await getAgentCheckpointContext(db, jobId);
  if (!context.latest) return undefined;
  const snapshot = await readSnapshot(artifacts, context.latest.artifactKey);
  verifyMetadata(snapshot, context.latest);
  return {
    checkpointId: context.latest.id,
    snapshot: snapshot.snapshot,
  };
}

export async function checkpointAgentWorkspace(
  db: SQL,
  artifacts: ArtifactStore,
  jobId: string,
  request: CheckpointAgentWorkspaceRequest,
): Promise<CheckpointAgentWorkspaceResponse> {
  const validated = validateSourceSnapshot(request.snapshot);
  if (validated.snapshot.fileCount === 0) {
    throw new HttpError(
      400,
      "EMPTY_SOURCE_SNAPSHOT",
      "An empty workspace cannot create a Checkpoint",
    );
  }
  const context = await getAgentCheckpointContext(db, jobId, request);
  const key = artifactKey(
    context.tenantId,
    context.dashboardId,
    validated.snapshot.digest,
  );
  try {
    await artifacts.write(
      key,
      encodeSourceSnapshot(validated.snapshot),
      "application/vnd.mda.source-snapshot+json",
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "artifact.write.failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    throw new HttpError(
      503,
      "ARTIFACT_UNAVAILABLE",
      "Dashboard source artifact could not be stored",
      true,
    );
  }
  const result = await insertDraftCheckpoint(db, {
    jobId,
    command: request,
    artifactKey: key,
    digest: validated.snapshot.digest,
    fileCount: validated.snapshot.fileCount,
    totalBytes: validated.snapshot.totalBytes,
  });
  return {
    created: result.created,
    checkpointId: result.checkpoint.id,
    digest: result.checkpoint.digest,
  };
}

export async function loadRevisionSnapshot(
  artifacts: ArtifactStore,
  revision: RevisionRecord,
): Promise<ValidatedSnapshot> {
  const snapshot = await readSnapshot(artifacts, revision.artifactKey);
  verifyMetadata(snapshot, revision);
  return snapshot;
}
