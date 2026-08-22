import type {
  AgentLeaseCommand,
  DashboardBuildArtifact,
  UploadPublicationResponse,
} from "@mda/contracts";
import type { SQL } from "bun";
import type { DataSourceClient } from "../../adapters/data-source-client.ts";
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
  dataSources: DataSourceClient | undefined,
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
  const bindings = await Promise.all(
    validated.artifact.manifest.queries.map(async (declaration) => {
      if (!dataSources) {
        throw new HttpError(
          503,
          "DATA_SOURCE_UNAVAILABLE",
          "Data Source Service is unavailable",
          true,
        );
      }
      const query = await dataSources.query(
        { tenantId: build.tenantId, userId: build.requestedBy },
        declaration.id,
      );
      if (
        query.status !== "active" ||
        query.revision !== declaration.revision
      ) {
        throw new HttpError(
          409,
          "QUERY_REVISION_MISMATCH",
          `Query ${declaration.id} Revision does not match the Manifest`,
        );
      }
      const expected = Object.fromEntries(
        query.parameters.map((parameter) => [parameter.name, parameter.type]),
      );
      if (JSON.stringify(expected) !== JSON.stringify(declaration.parameters)) {
        throw new HttpError(
          409,
          "QUERY_PARAMETER_MISMATCH",
          `Query ${declaration.id} parameters do not match the Manifest`,
        );
      }
      return {
        logicalName: declaration.id,
        queryId: query.id,
        revision: query.revision,
        publicExecution: query.public,
        parameters: declaration.parameters,
      };
    }),
  );
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
  const publication = await completePublication(
    db,
    build.id,
    command,
    {
      sourceDigest: validated.artifact.sourceDigest,
      manifestDigest: validated.artifact.manifestDigest,
      digest: validated.artifact.digest,
      artifactKey: key,
      fileCount: validated.artifact.fileCount,
      totalBytes: validated.artifact.totalBytes,
    },
    bindings,
  );
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

export async function readPublicationFile(
  artifacts: ArtifactStore,
  publication: PublicationRecord,
  path: string,
): Promise<{ bytes: Uint8Array; mediaType: string }> {
  const bundle = await readPublicationBundle(artifacts, publication);
  const file = bundle.files.find((candidate) => candidate.path === path);
  if (!file) {
    throw new HttpError(404, "PUBLICATION_FILE_NOT_FOUND", "Not found");
  }
  return { bytes: file.bytes, mediaType: file.mediaType };
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
