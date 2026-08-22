import { createHash } from "node:crypto";
import { posix } from "node:path";
import {
  type DashboardRevisionFile,
  type SourceSnapshot,
  SourceSnapshotSchema,
} from "@mda/contracts";
import { Value } from "@sinclair/typebox/value";
import { HttpError } from "../../shared/http.ts";
import { assertTarPath, createTarGzip } from "../../shared/tar.ts";

export const MAX_SNAPSHOT_FILES = 1_000;
export const MAX_SNAPSHOT_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_SNAPSHOT_BYTES = 20 * 1024 * 1024;

export interface ValidatedSnapshotFile {
  path: string;
  bytes: Uint8Array;
  executable: boolean;
  digest: string;
}

export interface ValidatedSnapshot {
  snapshot: SourceSnapshot;
  files: ValidatedSnapshotFile[];
}

const excludedSegments = new Set([".git", ".cache", "dist", "node_modules"]);

function invalidSnapshot(message: string): never {
  throw new HttpError(400, "INVALID_SOURCE_SNAPSHOT", message);
}

export function validateSourcePath(path: string): string {
  if (
    !path ||
    path.length > 240 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0") ||
    path !== posix.normalize(path) ||
    path
      .split("/")
      .some((segment) => !segment || segment === "." || segment === "..") ||
    [...path].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || code === 127;
    })
  ) {
    invalidSnapshot("Source snapshot contains an invalid path");
  }
  if (path.split("/").some((segment) => excludedSegments.has(segment))) {
    invalidSnapshot("Source snapshot contains an excluded path");
  }
  try {
    assertTarPath(path);
  } catch {
    invalidSnapshot("Source snapshot path is too long for tar export");
  }
  return path;
}

function decodeBase64(content: string): Uint8Array {
  const bytes = Buffer.from(content, "base64");
  if (bytes.toString("base64") !== content) {
    invalidSnapshot("Source snapshot contains invalid base64 content");
  }
  return bytes;
}

export function snapshotDigest(
  files: Array<{
    path: string;
    bytes: Uint8Array;
    executable: boolean;
  }>,
): { digest: string; fileDigests: string[]; totalBytes: number } {
  const aggregate = createHash("sha256");
  const fileDigests: string[] = [];
  let totalBytes = 0;
  for (const file of files) {
    const digest = createHash("sha256").update(file.bytes).digest("hex");
    fileDigests.push(digest);
    totalBytes += file.bytes.byteLength;
    aggregate.update(
      `${file.path}\0${file.executable ? "1" : "0"}\0${digest}\n`,
    );
  }
  return { digest: aggregate.digest("hex"), fileDigests, totalBytes };
}

export function validateSourceSnapshot(value: unknown): ValidatedSnapshot {
  if (!Value.Check(SourceSnapshotSchema, value)) {
    invalidSnapshot("Source snapshot does not match the contract");
  }
  const snapshot = value as SourceSnapshot;
  if (snapshot.files.length !== snapshot.fileCount) {
    invalidSnapshot("Source snapshot file count is inconsistent");
  }
  const files = snapshot.files
    .map((file) => ({
      path: validateSourcePath(file.path),
      bytes: decodeBase64(file.content),
      executable: file.executable,
    }))
    .sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    );
  if (
    files.some(
      (file, index) => index > 0 && file.path === files[index - 1]?.path,
    )
  ) {
    invalidSnapshot("Source snapshot contains duplicate paths");
  }
  if (files.some((file) => file.bytes.byteLength > MAX_SNAPSHOT_FILE_BYTES)) {
    invalidSnapshot("Source snapshot contains a file larger than 2 MiB");
  }
  const computed = snapshotDigest(files);
  if (computed.totalBytes > MAX_SNAPSHOT_BYTES) {
    invalidSnapshot("Source snapshot is larger than 20 MiB");
  }
  if (
    snapshot.digest !== computed.digest ||
    snapshot.totalBytes !== computed.totalBytes
  ) {
    invalidSnapshot("Source snapshot digest or size is inconsistent");
  }
  return {
    snapshot: {
      schemaVersion: 1,
      digest: computed.digest,
      fileCount: files.length,
      totalBytes: computed.totalBytes,
      files: files.map((file) => ({
        path: file.path,
        content: Buffer.from(file.bytes).toString("base64"),
        executable: file.executable,
      })),
    },
    files: files.map((file, index) => ({
      ...file,
      digest: computed.fileDigests[index] as string,
    })),
  };
}

export function encodeSourceSnapshot(snapshot: SourceSnapshot): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(snapshot));
}

export function decodeSourceSnapshot(data: Uint8Array): ValidatedSnapshot {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(data));
  } catch {
    throw new Error("Artifact snapshot is not valid JSON");
  }
  return validateSourceSnapshot(value);
}

export function revisionFiles(
  snapshot: ValidatedSnapshot,
): DashboardRevisionFile[] {
  return snapshot.files.map((file) => ({
    path: file.path,
    size: file.bytes.byteLength,
    digest: file.digest,
    executable: file.executable,
  }));
}

export function createSourceTarGzip(snapshot: ValidatedSnapshot): Uint8Array {
  return createTarGzip(snapshot.files);
}
