import { createHash } from "node:crypto";
import { posix } from "node:path";
import {
  type DashboardBuildArtifact,
  DashboardBuildArtifactSchema,
} from "@mda/contracts";
import { Value } from "@sinclair/typebox/value";
import { HttpError } from "../../shared/http.ts";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const mediaTypes = new Set([
  "application/json; charset=utf-8",
  "application/octet-stream",
  "font/woff",
  "font/woff2",
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/svg+xml",
  "image/webp",
  "image/x-icon",
  "text/css; charset=utf-8",
  "text/html; charset=utf-8",
  "text/javascript; charset=utf-8",
]);

export interface ValidatedBuildFile {
  path: string;
  bytes: Uint8Array;
  mediaType: string;
}

export interface ValidatedBuildArtifact {
  artifact: DashboardBuildArtifact;
  files: ValidatedBuildFile[];
}

function invalid(message: string): never {
  throw new HttpError(400, "INVALID_BUILD_ARTIFACT", message);
}

function validPath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= 240 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    path === posix.normalize(path) &&
    path
      .split("/")
      .every((segment) => segment && segment !== "." && segment !== "..")
  );
}

function decode(content: string): Uint8Array {
  const bytes = Buffer.from(content, "base64");
  if (bytes.toString("base64") !== content) {
    invalid("Build artifact contains invalid base64 content");
  }
  return bytes;
}

function digest(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function validateBuildArtifact(value: unknown): ValidatedBuildArtifact {
  if (!Value.Check(DashboardBuildArtifactSchema, value)) {
    invalid("Build artifact does not match the contract");
  }
  const artifact = value as DashboardBuildArtifact;
  if (artifact.files.length !== artifact.fileCount) {
    invalid("Build artifact file count is inconsistent");
  }
  const files = artifact.files
    .map((file) => ({
      path: file.path,
      bytes: decode(file.content),
      mediaType: file.mediaType,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  if (
    files.some(
      (file, index) =>
        !validPath(file.path) ||
        !mediaTypes.has(file.mediaType) ||
        file.bytes.length > MAX_FILE_BYTES ||
        (index > 0 && file.path === files[index - 1]?.path),
    )
  ) {
    invalid("Build artifact contains an invalid file");
  }
  if (!files.some((file) => file.path === "index.html")) {
    invalid("Build artifact entry index.html is missing");
  }
  const totalBytes = files.reduce(
    (total, file) => total + file.bytes.length,
    0,
  );
  if (totalBytes !== artifact.totalBytes || totalBytes > MAX_TOTAL_BYTES) {
    invalid("Build artifact size is inconsistent");
  }
  const aggregate = createHash("sha256");
  for (const file of files) {
    aggregate.update(
      `${file.path}\0${file.mediaType}\0${digest(file.bytes)}\n`,
    );
  }
  if (aggregate.digest("hex") !== artifact.digest) {
    invalid("Build artifact digest is inconsistent");
  }
  if (digest(JSON.stringify(artifact.manifest)) !== artifact.manifestDigest) {
    invalid("Build Manifest digest is inconsistent");
  }
  return {
    artifact: {
      ...artifact,
      files: files.map((file) => ({
        path: file.path,
        content: Buffer.from(file.bytes).toString("base64"),
        mediaType: file.mediaType,
      })),
    },
    files,
  };
}

export function encodeBuildArtifact(
  artifact: DashboardBuildArtifact,
): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(artifact));
}

export function decodeBuildArtifact(data: Uint8Array): ValidatedBuildArtifact {
  try {
    return validateBuildArtifact(JSON.parse(new TextDecoder().decode(data)));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new Error("Preview artifact is not valid JSON");
  }
}
