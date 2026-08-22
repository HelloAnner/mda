import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { SourceSnapshot } from "@mda/contracts";
import { buildDashboard, DashboardBuildError } from "./build.ts";

function snapshot(entries: Record<string, string>): SourceSnapshot {
  const files = Object.entries(entries)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, content]) => ({
      path,
      bytes: new TextEncoder().encode(content),
      executable: false,
    }));
  const aggregate = createHash("sha256");
  let totalBytes = 0;
  for (const file of files) {
    const fileDigest = createHash("sha256").update(file.bytes).digest("hex");
    aggregate.update(
      `${file.path}\0${file.executable ? "1" : "0"}\0${fileDigest}\n`,
    );
    totalBytes += file.bytes.length;
  }
  return {
    schemaVersion: 1,
    digest: aggregate.digest("hex"),
    fileCount: files.length,
    totalBytes,
    files: files.map((file) => ({
      path: file.path,
      content: Buffer.from(file.bytes).toString("base64"),
      executable: file.executable,
    })),
  };
}

function manifest(sourceEntry = "src/quiet/entry.tsx"): string {
  return JSON.stringify({
    schemaVersion: 1,
    title: "Quiet Precision",
    sourceEntry,
    entry: "dist/index.html",
    runtimeVersion: "1",
    queries: [],
  });
}

test("builds an arbitrary Agent-owned source tree with the fixed Vite shell", async () => {
  process.env.INTERNAL_AGENT_TOKEN = "must-not-enter-dashboard-bundle";
  const result = await buildDashboard(
    snapshot({
      "dashboard.manifest.json": manifest(),
      "src/quiet/entry.tsx": `import React from "react";
import { createRoot } from "react-dom/client";
import { dashboard } from "@mda/dashboard-runtime";
import "../surface.css";
const secret = import.meta.env.INTERNAL_AGENT_TOKEN;
function View() { return <main><h1>Quiet Precision</h1><p>{String(secret ?? "clean")}</p></main>; }
createRoot(document.getElementById("root")!).render(<View />);
dashboard.ready({ title: "Quiet Precision" });
`,
      "src/surface.css":
        "body { margin: 0; background: #f4f5f6; color: #17191c; }",
    }),
  );
  expect(result.artifact.manifest.sourceEntry).toBe("src/quiet/entry.tsx");
  expect(result.artifact.files.some(({ path }) => path === "index.html")).toBe(
    true,
  );
  const bundle = result.artifact.files
    .map(({ content }) => Buffer.from(content, "base64").toString("utf8"))
    .join("\n");
  expect(bundle).toContain("Quiet Precision");
  expect(bundle).not.toContain("must-not-enter-dashboard-bundle");
  expect(result.artifact.digest).toMatch(/^[a-f0-9]{64}$/);
}, 30_000);

test("rejects protected files, unapproved imports, and external destinations", async () => {
  const cases: Array<{ files: Record<string, string>; code: string }> = [
    {
      files: { "package.json": "{}" },
      code: "SOURCE_BOUNDARY_VIOLATION",
    },
    {
      files: {
        "src/quiet/entry.tsx":
          'import x from "unreviewed-package"; console.log(x);',
      },
      code: "DEPENDENCY_NOT_APPROVED",
    },
    {
      files: {
        "src/quiet/entry.tsx": 'fetch("https://untrusted.example/data");',
      },
      code: "EXTERNAL_NETWORK_PROHIBITED",
    },
  ];
  for (const value of cases) {
    try {
      await buildDashboard(
        snapshot({ "dashboard.manifest.json": manifest(), ...value.files }),
      );
      throw new Error("Expected build validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(DashboardBuildError);
      expect((error as DashboardBuildError).code).toBe(value.code);
    }
  }
});
