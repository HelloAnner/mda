import { expect, test } from "bun:test";
import type { SourceSnapshot } from "@mda/contracts";
import {
  createSourceTarGzip,
  revisionFiles,
  snapshotDigest,
  validateSourceSnapshot,
} from "./snapshot.ts";

function snapshot(): SourceSnapshot {
  const files = [
    {
      path: "README.md",
      bytes: new TextEncoder().encode("Dashboard source\n"),
      executable: false,
    },
    {
      path: "src/run.sh",
      bytes: new TextEncoder().encode("#!/bin/sh\necho ok\n"),
      executable: true,
    },
  ];
  const computed = snapshotDigest(files);
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

test("validates source metadata and creates a deterministic tar gzip", () => {
  const validated = validateSourceSnapshot(snapshot());
  expect(revisionFiles(validated).map(({ path }) => path)).toEqual([
    "README.md",
    "src/run.sh",
  ]);

  const tar = Bun.gunzipSync(Uint8Array.from(createSourceTarGzip(validated)));
  expect(
    Buffer.from(tar.subarray(0, 100)).toString().replaceAll("\0", ""),
  ).toBe("README.md");
  expect(Buffer.from(tar.subarray(512, 529)).toString()).toBe(
    "Dashboard source\n",
  );
  expect(createSourceTarGzip(validated)).toEqual(
    createSourceTarGzip(validated),
  );
});

test("rejects traversal, excluded files, duplicate paths, and bad digests", () => {
  for (const path of ["../secret", "/absolute", "node_modules/key", "a\\b"]) {
    const value = snapshot();
    const first = value.files[0];
    if (!first) throw new Error("Test snapshot is empty");
    value.files[0] = { ...first, path };
    expect(() => validateSourceSnapshot(value)).toThrow("path");
  }

  const duplicate = snapshot();
  const second = duplicate.files[1];
  if (!second) throw new Error("Test snapshot has no second file");
  duplicate.files[1] = { ...second, path: "README.md" };
  expect(() => validateSourceSnapshot(duplicate)).toThrow("duplicate");

  const corrupt = snapshot();
  corrupt.digest = "0".repeat(64);
  expect(() => validateSourceSnapshot(corrupt)).toThrow("inconsistent");
});
