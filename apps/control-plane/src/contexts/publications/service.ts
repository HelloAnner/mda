import type {
  AgentLeaseCommand,
  DashboardBuildArtifact,
  UploadPublicationResponse,
} from "@mda/contracts";
import type { SQL } from "bun";
import type { ArtifactStore } from "../../shared/artifacts.ts";
import { HttpError } from "../../shared/http.ts";
import { createTarGzip } from "../../shared/tar.ts";
import {
  decodeBuildArtifact,
  encodeBuildArtifact,
  validateBuildArtifact,
} from "../previews/bundle.ts";
import {
  completePublication,
  getPublicationUploadContext,
  type PublicationRecord,
} from "./postgres.ts";

function artifactKey(
  tenantId: string,
  dashboardId: string,
  digest: string,
): string {
  return `publication-bundles/${encodeURIComponent(tenantId)}/${encodeURIComponent(dashboardId)}/${digest}.json`;
}

export async function storePublicationArtifact(
  db: SQL,
  artifacts: ArtifactStore,
  jobId: string,
  command: AgentLeaseCommand,
  value: DashboardBuildArtifact,
): Promise<UploadPublicationResponse> {
  const validated = validateBuildArtifact(value);
  const build = await getPublicationUploadContext(db, jobId, command);
  if (validated.artifact.sourceDigest !== build.sourceDigest) {
    throw new HttpError(
      409,
      "PUBLICATION_SOURCE_CONFLICT",
      "Publication build does not match its Revision source",
    );
  }
  if (validated.artifact.manifest.queries.length > 0) {
    throw new HttpError(
      409,
      "QUERY_BINDINGS_UNAVAILABLE",
      "Dashboard Queries must be bound to immutable Query Revisions before publication",
    );
  }
  const key = artifactKey(
    build.tenantId,
    build.dashboardId,
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
        event: "publication.artifact.write.failed",
        jobId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    throw new HttpError(
      503,
      "ARTIFACT_UNAVAILABLE",
      "Publication artifact could not be stored",
      true,
    );
  }
  const publication = await completePublication(db, build.id, command, {
    sourceDigest: validated.artifact.sourceDigest,
    manifestDigest: validated.artifact.manifestDigest,
    digest: validated.artifact.digest,
    artifactKey: key,
    fileCount: validated.artifact.fileCount,
    totalBytes: validated.artifact.totalBytes,
  });
  return {
    publicationId: publication.id,
    number: publication.number,
    digest: publication.buildDigest,
  };
}

async function readPublicationBundle(
  artifacts: ArtifactStore,
  publication: PublicationRecord,
) {
  try {
    const bundle = decodeBuildArtifact(
      await artifacts.read(publication.artifactKey),
    );
    if (
      bundle.artifact.digest !== publication.buildDigest ||
      bundle.artifact.sourceDigest !== publication.sourceDigest ||
      bundle.artifact.manifestDigest !== publication.manifestDigest ||
      bundle.artifact.fileCount !== publication.fileCount ||
      bundle.artifact.totalBytes !== publication.totalBytes
    ) {
      throw new Error("Publication artifact metadata is inconsistent");
    }
    return bundle;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "publication.artifact.read.failed",
        publicationId: publication.id,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    throw new HttpError(
      503,
      "ARTIFACT_UNAVAILABLE",
      "Publication artifact is unavailable",
      true,
    );
  }
}

export async function exportPublicationBundle(
  artifacts: ArtifactStore,
  publication: PublicationRecord,
): Promise<Uint8Array> {
  const bundle = await readPublicationBundle(artifacts, publication);
  return createTarGzip(
    bundle.files.map((file) => ({
      path: file.path,
      bytes: file.bytes,
      executable: false,
    })),
  );
}
