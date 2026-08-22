import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { type SourceSnapshot, SourceSnapshotSchema } from "@mda/contracts";
import { Value } from "@sinclair/typebox/value";

const MAX_FILES = 1_000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const excluded = new Set([".cache", ".git", "dist", "node_modules"]);

interface WorkspaceFile {
  path: string;
  bytes: Uint8Array;
  executable: boolean;
}

function validatePath(path: string): string {
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
    throw new Error("Invalid workspace snapshot path");
  }
  if (path.split("/").some((segment) => excluded.has(segment))) {
    throw new Error("Workspace snapshot contains an excluded path");
  }
  return path;
}

function digestFiles(files: WorkspaceFile[]): {
  digest: string;
  totalBytes: number;
} {
  const aggregate = createHash("sha256");
  let totalBytes = 0;
  for (const file of files) {
    const digest = createHash("sha256").update(file.bytes).digest("hex");
    totalBytes += file.bytes.byteLength;
    aggregate.update(
      `${file.path}\0${file.executable ? "1" : "0"}\0${digest}\n`,
    );
  }
  return { digest: aggregate.digest("hex"), totalBytes };
}

async function workspaceFiles(
  root: string,
  directory = "",
): Promise<WorkspaceFile[]> {
  const files: WorkspaceFile[] = [];
  const entries = await readdir(join(root, directory), { withFileTypes: true });
  for (const entry of entries) {
    if (excluded.has(entry.name)) continue;
    const path = validatePath(
      directory ? `${directory}/${entry.name}` : entry.name,
    );
    const absolute = join(root, path);
    const stats = await lstat(absolute);
    if (stats.isSymbolicLink()) {
      throw new Error(`Workspace snapshot cannot include symlink: ${path}`);
    }
    if (stats.isDirectory()) {
      files.push(...(await workspaceFiles(root, path)));
      continue;
    }
    if (!stats.isFile()) {
      throw new Error(
        `Workspace snapshot cannot include special file: ${path}`,
      );
    }
    if (stats.size > MAX_FILE_BYTES) {
      throw new Error(`Workspace file exceeds 2 MiB: ${path}`);
    }
    files.push({
      path,
      bytes: await readFile(absolute),
      executable: Boolean(stats.mode & 0o111),
    });
    if (files.length > MAX_FILES) {
      throw new Error("Workspace snapshot exceeds 1,000 files");
    }
  }
  return files;
}

export async function captureWorkspace(root: string): Promise<SourceSnapshot> {
  await mkdir(root, { recursive: true });
  const files = (await workspaceFiles(root)).sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  const computed = digestFiles(files);
  if (computed.totalBytes > MAX_TOTAL_BYTES) {
    throw new Error("Workspace snapshot exceeds 20 MiB");
  }
  return {
    schemaVersion: 1,
    digest: computed.digest,
    fileCount: files.length,
    totalBytes: computed.totalBytes,
    files: files.map((file) => ({
      path: file.path,
      content: Buffer.from(file.bytes).toString("base64"),
      executable: file.executable,
    })),
  };
}

function validatedFiles(snapshot: SourceSnapshot): WorkspaceFile[] {
  if (!Value.Check(SourceSnapshotSchema, snapshot)) {
    throw new Error("Invalid restored workspace snapshot");
  }
  const files = snapshot.files
    .map((file) => {
      const bytes = Buffer.from(file.content, "base64");
      if (bytes.toString("base64") !== file.content) {
        throw new Error("Invalid restored workspace content");
      }
      if (bytes.byteLength > MAX_FILE_BYTES) {
        throw new Error("Restored workspace file exceeds 2 MiB");
      }
      return {
        path: validatePath(file.path),
        bytes,
        executable: file.executable,
      };
    })
    .sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    );
  if (
    files.length !== snapshot.fileCount ||
    files.some(
      (file, index) => index > 0 && file.path === files[index - 1]?.path,
    )
  ) {
    throw new Error("Invalid restored workspace file list");
  }
  const computed = digestFiles(files);
  if (
    computed.digest !== snapshot.digest ||
    computed.totalBytes !== snapshot.totalBytes ||
    computed.totalBytes > MAX_TOTAL_BYTES
  ) {
    throw new Error("Restored workspace digest is inconsistent");
  }
  return files;
}

export async function restoreWorkspace(
  root: string,
  snapshot?: SourceSnapshot,
): Promise<void> {
  const files = snapshot ? validatedFiles(snapshot) : [];
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  for (const file of files) {
    const absolute = join(root, file.path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, file.bytes, {
      mode: file.executable ? 0o755 : 0o644,
    });
    if (file.executable) await chmod(absolute, 0o755);
  }
}
