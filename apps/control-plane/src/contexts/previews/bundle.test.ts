import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { DashboardBuildArtifact } from "@mda/contracts";
import {
  decodeBuildArtifact,
  encodeBuildArtifact,
  validateBuildArtifact,
} from "./bundle.ts";
import { previewPath, verifyPreviewToken } from "./token.ts";

function artifact(): DashboardBuildArtifact {
  const bytes = new TextEncoder().encode("<!doctype html><h1>Preview</h1>");
  const mediaType = "text/html; charset=utf-8";
  const fileDigest = createHash("sha256").update(bytes).digest("hex");
  const aggregate = createHash("sha256")
    .update(`index.html\0${mediaType}\0${fileDigest}\n`)
    .digest("hex");
  const manifest = {
    schemaVersion: 1 as const,
    title: "Preview",
    sourceEntry: "src/start.ts",
    entry: "dist/index.html" as const,
    runtimeVersion: "1" as const,
    queries: [],
  };
  return {
    schemaVersion: 1,
    sourceDigest: "a".repeat(64),
    manifestDigest: createHash("sha256")
      .update(JSON.stringify(manifest))
      .digest("hex"),
    digest: aggregate,
    templateVersion: "1",
    runtimeVersion: "1",
    fileCount: 1,
    totalBytes: bytes.length,
    manifest,
    files: [
      {
        path: "index.html",
        content: Buffer.from(bytes).toString("base64"),
        mediaType,
      },
    ],
  };
}

test("validates and round-trips immutable Preview bundles", () => {
  const value = artifact();
  const validated = validateBuildArtifact(value);
  expect(validated.files[0]?.bytes).toEqual(
    new TextEncoder().encode("<!doctype html><h1>Preview</h1>"),
  );
  expect(decodeBuildArtifact(encodeBuildArtifact(value)).artifact).toEqual(
    value,
  );
});

test("rejects tampered Preview paths and content", () => {
  const badPath = artifact();
  const badFile = badPath.files[0];
  if (!badFile) throw new Error("Test artifact has no file");
  badPath.files[0] = { ...badFile, path: "../secret" };
  expect(() => validateBuildArtifact(badPath)).toThrow(
    "Build artifact contains an invalid file",
  );

  const tampered = artifact();
  const tamperedFile = tampered.files[0];
  if (!tamperedFile) throw new Error("Test artifact has no file");
  tampered.files[0] = {
    ...tamperedFile,
    content: Buffer.from("changed").toString("base64"),
  };
  expect(() => validateBuildArtifact(tampered)).toThrow(
    "Build artifact size is inconsistent",
  );
});

test("binds signed Preview paths to one ID and expiry", () => {
  const key = "preview-signing-key-at-least-32-bytes";
  const expiresAt = "2026-08-22T10:00:00.000Z";
  const path = previewPath(key, "preview_1", expiresAt);
  const token = path.split("/")[3] as string;
  expect(verifyPreviewToken(key, "preview_1", expiresAt, token)).toBe(true);
  expect(verifyPreviewToken(key, "preview_2", expiresAt, token)).toBe(false);
  expect(
    verifyPreviewToken(key, "preview_1", "2026-08-22T11:00:00.000Z", token),
  ).toBe(false);
});
