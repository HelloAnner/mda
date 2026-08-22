import { expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureWorkspace, restoreWorkspace } from "./workspace.ts";

function temporaryWorkspace(): string {
  return mkdtempSync(join(tmpdir(), "mda-workspace-"));
}

test("captures and restores a deterministic source snapshot", async () => {
  const source = temporaryWorkspace();
  const restored = temporaryWorkspace();
  try {
    mkdirSync(join(source, "src"), { recursive: true });
    writeFileSync(join(source, "src/app.ts"), "export const value = 1;\n");
    writeFileSync(join(source, "run.sh"), "#!/bin/sh\necho ok\n");
    chmodSync(join(source, "run.sh"), 0o755);
    mkdirSync(join(source, "node_modules/ignored"), { recursive: true });
    writeFileSync(join(source, "node_modules/ignored/index.js"), "ignored");
    mkdirSync(join(source, "dist"), { recursive: true });
    writeFileSync(join(source, "dist/index.html"), "ignored");

    const snapshot = await captureWorkspace(source);
    expect(snapshot.files.map(({ path }) => path)).toEqual([
      "run.sh",
      "src/app.ts",
    ]);
    expect(snapshot.fileCount).toBe(2);

    await restoreWorkspace(restored, snapshot);
    expect(readFileSync(join(restored, "src/app.ts"), "utf8")).toBe(
      "export const value = 1;\n",
    );
    expect(existsSync(join(restored, "node_modules"))).toBe(false);
    expect(await captureWorkspace(restored)).toEqual(snapshot);
  } finally {
    rmSync(source, { recursive: true, force: true });
    rmSync(restored, { recursive: true, force: true });
  }
});

test("rejects symlinks and corrupted restored snapshots", async () => {
  const source = temporaryWorkspace();
  const restored = temporaryWorkspace();
  try {
    writeFileSync(join(source, "safe.txt"), "safe");
    symlinkSync("safe.txt", join(source, "link.txt"));
    expect(captureWorkspace(source)).rejects.toThrow("symlink");
    rmSync(join(source, "link.txt"));

    const snapshot = await captureWorkspace(source);
    snapshot.digest = "0".repeat(64);
    expect(restoreWorkspace(restored, snapshot)).rejects.toThrow("digest");
  } finally {
    rmSync(source, { recursive: true, force: true });
    rmSync(restored, { recursive: true, force: true });
  }
});
