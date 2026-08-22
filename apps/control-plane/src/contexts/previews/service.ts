import type {
  AgentLeaseCommand,
  DashboardBuildArtifact,
  UploadDashboardPreviewResponse,
} from "@mda/contracts";
import type { SQL } from "bun";
import type { ArtifactStore } from "../../shared/artifacts.ts";
import { HttpError } from "../../shared/http.ts";
import {
  decodeBuildArtifact,
  encodeBuildArtifact,
  validateBuildArtifact,
} from "./bundle.ts";
import {
  completePreview,
  getPreviewUploadContext,
  type PreviewRecord,
} from "./postgres.ts";
import { previewPath } from "./token.ts";

function artifactKey(
  tenantId: string,
  dashboardId: string,
  digest: string,
): string {
  return `preview-bundles/${encodeURIComponent(tenantId)}/${encodeURIComponent(dashboardId)}/${digest}.json`;
}

export async function storePreviewArtifact(
  db: SQL,
  artifacts: ArtifactStore,
  signingKey: string,
  ttlSeconds: number,
  jobId: string,
  command: AgentLeaseCommand,
  value: DashboardBuildArtifact,
): Promise<UploadDashboardPreviewResponse> {
  const validated = validateBuildArtifact(value);
  const context = await getPreviewUploadContext(
    db,
    jobId,
    command,
    validated.artifact.sourceDigest,
    new Date(),
    ttlSeconds,
  );
  if (validated.artifact.sourceDigest !== context.sourceDigest) {
    throw new HttpError(
      409,
      "PREVIEW_SOURCE_CONFLICT",
      "Preview build does not match its pinned source",
    );
  }
  const key = artifactKey(
    context.tenantId,
    context.dashboardId,
    validated.artifact.digest,
  );
  try {
    await artifacts.write(
      key,
      encodeBuildArtifact(validated.artifact),
      "application/vnd.mda.dashboard-build+json",
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "preview.artifact.write.failed",
        jobId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    throw new HttpError(
      503,
      "ARTIFACT_UNAVAILABLE",
      "Preview artifact could not be stored",
      true,
    );
  }
  const preview = await completePreview(db, context, command, {
    sourceDigest: validated.artifact.sourceDigest,
    manifestDigest: validated.artifact.manifestDigest,
    digest: validated.artifact.digest,
    artifactKey: key,
    fileCount: validated.artifact.fileCount,
    totalBytes: validated.artifact.totalBytes,
  });
  return {
    previewId: preview.id,
    path: previewPath(signingKey, preview.id, preview.expiresAt),
    digest: validated.artifact.digest,
  };
}

export async function readPreviewFile(
  artifacts: ArtifactStore,
  preview: PreviewRecord,
  path: string,
): Promise<{ bytes: Uint8Array; mediaType: string }> {
  if (preview.status !== "ready" || !preview.artifactKey) {
    throw new HttpError(425, "PREVIEW_NOT_READY", "Preview is not ready");
  }
  let bundle: ReturnType<typeof decodeBuildArtifact>;
  try {
    bundle = decodeBuildArtifact(await artifacts.read(preview.artifactKey));
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "preview.artifact.read.failed",
        previewId: preview.id,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    throw new HttpError(
      503,
      "ARTIFACT_UNAVAILABLE",
      "Preview artifact is unavailable",
      true,
    );
  }
  if (
    bundle.artifact.digest !== preview.buildDigest ||
    bundle.artifact.sourceDigest !== preview.sourceDigest ||
    bundle.artifact.manifestDigest !== preview.manifestDigest
  ) {
    throw new HttpError(
      503,
      "ARTIFACT_UNAVAILABLE",
      "Preview artifact metadata is inconsistent",
      true,
    );
  }
  const file = bundle.files.find((candidate) => candidate.path === path);
  if (!file) throw new HttpError(404, "PREVIEW_FILE_NOT_FOUND", "Not found");
  return { bytes: file.bytes, mediaType: file.mediaType };
}
