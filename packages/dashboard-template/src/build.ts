import { createHash } from "node:crypto";
import {
  access,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type DashboardBuildArtifact,
  type DashboardBuildFile,
  type DashboardManifest,
  DashboardManifestSchema,
  type SourceSnapshot,
} from "@mda/contracts";
import { Value } from "@sinclair/typebox/value";

export const DASHBOARD_TEMPLATE_VERSION = "1" as const;
export const DASHBOARD_RUNTIME_VERSION = "1" as const;
const MAX_BUILD_FILE_BYTES = 10 * 1024 * 1024;
const MAX_BUILD_BYTES = 50 * 1024 * 1024;
const MAX_BUILD_FILES = 1_000;
const MAX_LOG_BYTES = 50 * 1024;
const BUILD_TIMEOUT_MS = 120_000;
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"]);
const TEXT_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".svg",
  ".ts",
  ".tsx",
  ".txt",
]);
const APPROVED_IMPORTS = [
  "@mda/dashboard-runtime",
  "d3",
  "echarts",
  "lucide-react",
  "react",
  "react-dom",
];

export class DashboardBuildError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly path?: string,
    readonly log?: string,
  ) {
    super(message);
  }
}

export interface DashboardBuildResult {
  artifact: DashboardBuildArtifact;
  durationMs: number;
  log: string;
}

function digest(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function normalizedPath(path: string): boolean {
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

function extension(path: string): string {
  const index = path.lastIndexOf(".");
  return index < 0 ? "" : path.slice(index).toLowerCase();
}

function safeDecode(bytes: Uint8Array, path: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new DashboardBuildError(
      "SOURCE_ENCODING_INVALID",
      "Dashboard text source must be valid UTF-8",
      path,
    );
  }
}

function parseManifest(
  file: SourceSnapshot["files"][number],
): DashboardManifest {
  let value: unknown;
  try {
    value = JSON.parse(
      safeDecode(Buffer.from(file.content, "base64"), file.path),
    );
  } catch (error) {
    if (error instanceof DashboardBuildError) throw error;
    throw new DashboardBuildError(
      "MANIFEST_INVALID",
      "dashboard.manifest.json is not valid JSON",
      file.path,
    );
  }
  if (!Value.Check(DashboardManifestSchema, value)) {
    const reason = [...Value.Errors(DashboardManifestSchema, value)]
      .slice(0, 5)
      .map(({ path, message }) => `${path || "/"} ${message}`)
      .join("; ");
    throw new DashboardBuildError(
      "MANIFEST_INVALID",
      `dashboard.manifest.json does not match the contract: ${reason}`,
      file.path,
    );
  }
  const manifest = value as DashboardManifest;
  if (
    !normalizedPath(manifest.sourceEntry) ||
    !manifest.sourceEntry.startsWith("src/") ||
    !SOURCE_EXTENSIONS.has(extension(manifest.sourceEntry))
  ) {
    throw new DashboardBuildError(
      "SOURCE_ENTRY_INVALID",
      "Manifest sourceEntry must be a normalized JavaScript or TypeScript module under src/",
      file.path,
    );
  }
  const queryIds = new Set<string>();
  for (const query of manifest.queries) {
    if (queryIds.has(query.id)) {
      throw new DashboardBuildError(
        "MANIFEST_QUERY_DUPLICATE",
        `Manifest declares duplicate Query ID: ${query.id}`,
        file.path,
      );
    }
    queryIds.add(query.id);
  }
  return manifest;
}

function approvedImport(specifier: string): boolean {
  if (
    specifier.startsWith("./") ||
    specifier.startsWith("../") ||
    specifier.startsWith("/")
  ) {
    return true;
  }
  return APPROVED_IMPORTS.some(
    (approved) =>
      specifier === approved || specifier.startsWith(`${approved}/`),
  );
}

function validateTextSource(path: string, source: string): void {
  const importPattern =
    /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1] as string;
    if (!approvedImport(specifier)) {
      throw new DashboardBuildError(
        "DEPENDENCY_NOT_APPROVED",
        `Dependency is not in the approved Dashboard Template: ${specifier}`,
        path,
      );
    }
  }
  const externalDestination = [
    /\b(?:fetch|WebSocket|EventSource)\s*\(\s*["']https?:\/\//i,
    /\b(?:src|href)\s*=\s*(?:["']https?:\/\/|\{\s*["']https?:\/\/)/i,
    /\burl\(\s*["']?https?:\/\//i,
    /\bimport\s*\(\s*["']https?:\/\//i,
  ].some((pattern) => pattern.test(source));
  if (externalDestination) {
    throw new DashboardBuildError(
      "EXTERNAL_NETWORK_PROHIBITED",
      "Dashboard source cannot load or connect to external network destinations",
      path,
    );
  }
  const secretLiteral = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\b(?:api[_-]?key|access[_-]?token|secret|password)\b\s*[:=]\s*["'][^"'\n]{12,}["']/i,
    /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
    /\bsk-[A-Za-z0-9_-]{20,}\b/,
  ].some((pattern) => pattern.test(source));
  if (secretLiteral) {
    throw new DashboardBuildError(
      "POSSIBLE_SECRET",
      "Dashboard source appears to contain a credential literal",
      path,
    );
  }
}

function validateSource(snapshot: SourceSnapshot): {
  manifest: DashboardManifest;
  files: Array<{ path: string; bytes: Uint8Array; executable: boolean }>;
} {
  const files = snapshot.files.map((file) => ({
    path: file.path,
    bytes: new Uint8Array(Buffer.from(file.content, "base64")),
    executable: file.executable,
  }));
  const manifestFile = snapshot.files.find(
    (file) => file.path === "dashboard.manifest.json",
  );
  if (!manifestFile) {
    throw new DashboardBuildError(
      "MANIFEST_MISSING",
      "Dashboard source requires dashboard.manifest.json",
    );
  }
  for (const file of files) {
    if (
      file.path !== "dashboard.manifest.json" &&
      !file.path.startsWith("src/") &&
      !file.path.startsWith("public/")
    ) {
      throw new DashboardBuildError(
        "SOURCE_BOUNDARY_VIOLATION",
        "Build input may contain only dashboard.manifest.json, src/**, and public/**",
        file.path,
      );
    }
    if (file.path === "public/index.html") {
      throw new DashboardBuildError(
        "SOURCE_BOUNDARY_VIOLATION",
        "public/index.html cannot replace the platform-owned HTML shell",
        file.path,
      );
    }
    if (TEXT_EXTENSIONS.has(extension(file.path))) {
      validateTextSource(file.path, safeDecode(file.bytes, file.path));
    }
  }
  const manifest = parseManifest(manifestFile);
  if (!files.some((file) => file.path === manifest.sourceEntry)) {
    throw new DashboardBuildError(
      "SOURCE_ENTRY_MISSING",
      `Manifest sourceEntry does not exist: ${manifest.sourceEntry}`,
      manifest.sourceEntry,
    );
  }
  return { manifest, files };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character] as string;
  });
}

async function materialize(
  root: string,
  manifest: DashboardManifest,
  files: Array<{ path: string; bytes: Uint8Array; executable: boolean }>,
): Promise<void> {
  for (const file of files) {
    if (file.path === "dashboard.manifest.json") continue;
    const target = join(root, ...file.path.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.bytes);
    if (file.executable) await chmod(target, 0o755);
  }
  await writeFile(
    join(root, "index.html"),
    `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="UTF-8" />\n<meta name="viewport" content="width=device-width, initial-scale=1.0" />\n<title>${escapeHtml(manifest.title)}</title>\n</head>\n<body>\n<div id="root"></div>\n<script type="module" src="/${manifest.sourceEntry}"></script>\n</body>\n</html>\n`,
  );
  const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const candidates = [
    join(packageRoot, "node_modules"),
    join(process.cwd(), "node_modules"),
  ];
  const nodeModules = await candidates.reduce<Promise<string>>(
    async (found, candidate) => {
      const existing = await found;
      if (existing) return existing;
      try {
        await access(join(candidate, "react", "package.json"));
        return candidate;
      } catch {
        return "";
      }
    },
    Promise.resolve(""),
  );
  if (!nodeModules) {
    throw new DashboardBuildError(
      "BUILD_ENVIRONMENT_INVALID",
      "Approved Dashboard Template dependencies are unavailable",
    );
  }
  await symlink(nodeModules, join(root, "node_modules"));
}

async function collectBuildFiles(
  root: string,
): Promise<Array<{ path: string; bytes: Uint8Array }>> {
  const files: Array<{ path: string; bytes: Uint8Array }> = [];
  async function visit(directory: string, prefix: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new DashboardBuildError(
          "BUILD_ARTIFACT_INVALID",
          "Build output cannot contain symbolic links",
          path,
        );
      }
      if (entry.isDirectory()) await visit(absolute, path);
      else if (entry.isFile()) {
        const stat = await lstat(absolute);
        if (stat.size > MAX_BUILD_FILE_BYTES) {
          throw new DashboardBuildError(
            "BUILD_ARTIFACT_TOO_LARGE",
            "Build output contains a file larger than 10 MiB",
            path,
          );
        }
        files.push({ path, bytes: new Uint8Array(await readFile(absolute)) });
      }
    }
  }
  await visit(root, "");
  if (files.length === 0 || !files.some((file) => file.path === "index.html")) {
    throw new DashboardBuildError(
      "BUILD_ENTRY_MISSING",
      "Dashboard build did not produce dist/index.html",
    );
  }
  if (files.length > MAX_BUILD_FILES) {
    throw new DashboardBuildError(
      "BUILD_ARTIFACT_TOO_LARGE",
      "Dashboard build produced more than 1,000 files",
    );
  }
  const totalBytes = files.reduce(
    (total, file) => total + file.bytes.length,
    0,
  );
  if (totalBytes > MAX_BUILD_BYTES) {
    throw new DashboardBuildError(
      "BUILD_ARTIFACT_TOO_LARGE",
      "Dashboard build is larger than 50 MiB",
    );
  }
  return files;
}

function mediaType(path: string): string {
  const types: Record<string, string> = {
    ".avif": "image/avif",
    ".css": "text/css; charset=utf-8",
    ".gif": "image/gif",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  };
  return types[extension(path)] ?? "application/octet-stream";
}

function boundedLog(value: string): string {
  const bytes = Buffer.from(value);
  if (bytes.length <= MAX_LOG_BYTES) return value.trim();
  return Buffer.concat([
    Buffer.from("[earlier build output truncated]\n"),
    bytes.subarray(bytes.length - MAX_LOG_BYTES),
  ])
    .toString("utf8")
    .trim();
}

export async function buildDashboard(
  snapshot: SourceSnapshot,
  signal?: AbortSignal,
): Promise<DashboardBuildResult> {
  const started = performance.now();
  const { manifest, files } = validateSource(snapshot);
  const root = await mkdtemp(join(tmpdir(), "mda-dashboard-build-"));
  try {
    await materialize(root, manifest, files);
    await Promise.all([
      mkdir(join(root, ".home"), { recursive: true }),
      mkdir(join(root, ".tmp"), { recursive: true }),
    ]);
    const timeout = AbortSignal.timeout(BUILD_TIMEOUT_MS);
    const buildSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const script = fileURLToPath(new URL("./vite-build.ts", import.meta.url));
    const subprocess = Bun.spawn([process.execPath, script, root], {
      cwd: root,
      env: {
        CI: "1",
        HOME: join(root, ".home"),
        NODE_ENV: "production",
        PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
        TMPDIR: join(root, ".tmp"),
      },
      stdout: "pipe",
      stderr: "pipe",
      signal: buildSignal,
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(subprocess.stdout).text(),
      new Response(subprocess.stderr).text(),
      subprocess.exited,
    ]);
    const log = boundedLog(`${stdout}\n${stderr}`);
    if (exitCode !== 0) {
      throw new DashboardBuildError(
        buildSignal.aborted ? "BUILD_TIMEOUT" : "BUILD_FAILED",
        buildSignal.aborted
          ? "Dashboard build was cancelled or timed out"
          : "Dashboard build failed",
        undefined,
        log,
      );
    }
    const output = await collectBuildFiles(join(root, "dist"));
    const buildFiles: DashboardBuildFile[] = output.map((file) => ({
      path: file.path,
      content: Buffer.from(file.bytes).toString("base64"),
      mediaType: mediaType(file.path),
    }));
    const aggregate = createHash("sha256");
    for (const file of output) {
      aggregate.update(
        `${file.path}\0${mediaType(file.path)}\0${digest(file.bytes)}\n`,
      );
    }
    const manifestJson = JSON.stringify(manifest);
    const artifact: DashboardBuildArtifact = {
      schemaVersion: 1,
      sourceDigest: snapshot.digest,
      manifestDigest: digest(manifestJson),
      digest: aggregate.digest("hex"),
      templateVersion: DASHBOARD_TEMPLATE_VERSION,
      runtimeVersion: DASHBOARD_RUNTIME_VERSION,
      fileCount: output.length,
      totalBytes: output.reduce((total, file) => total + file.bytes.length, 0),
      manifest,
      files: buildFiles,
    };
    return {
      artifact,
      durationMs: Math.round(performance.now() - started),
      log,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
