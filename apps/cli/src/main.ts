#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  type AgentJob,
  AgentJobListResponseSchema,
  AgentJobSchema,
  CreateDashboardPreviewResponseSchema,
  CreatePublicationResponseSchema,
  CreateShareLinkResponseSchema,
  type Dashboard,
  type DashboardFolder,
  DashboardFolderListResponseSchema,
  DashboardFolderSchema,
  DashboardListResponseSchema,
  DashboardPreviewSchema,
  type DashboardRevision,
  DashboardRevisionFileListResponseSchema,
  DashboardRevisionListResponseSchema,
  DashboardRevisionSchema,
  DashboardSchema,
  DataSourceDescriptionSchema,
  DataSourceListResponseSchema,
  DataSourceSchema,
  DataSourceTestResultSchema,
  type Publication,
  PublicationBuildSchema,
  PublicationListResponseSchema,
  PublicationSchema,
  QueryResultSchema,
  RegisteredQueryListResponseSchema,
  RegisteredQuerySchema,
  type ServiceMetadata,
  ServiceMetadataSchema,
  ShareLinkListResponseSchema,
  ShareLinkSchema,
} from "@mda/contracts";
import { Value } from "@sinclair/typebox/value";
import packageJson from "../package.json" with { type: "json" };
import { ApiClientError, apiFetch, apiRequest } from "./client/api.ts";
import { chat, watchJob } from "./interactive/chat.ts";

const help = `mda ${packageJson.version}

Usage:
  mda [global options] <command> [subcommand] [arguments]

Commands:
  doctor
  chat <dashboard-id> [--session <session-id>]
  dashboard list [--limit <n>]
  dashboard create --name <name> [--description <text>] [--folder <folder-id>] [--idempotency-key <key>]
  dashboard show <dashboard-id>
  dashboard update <dashboard-id> [--name <name>] [--description <text>] [--folder <folder-id> | --root] --expected-version <n>
  dashboard archive <dashboard-id> --expected-version <n>
  dashboard preview <dashboard-id> [--revision <revision-id>]
  folder list
  folder create --name <name> [--parent <folder-id>]
  folder rename <folder-id> --name <name> --expected-version <n>
  folder move <folder-id> (--parent <folder-id> | --root) --expected-version <n>
  folder delete <folder-id> --expected-version <n>
  dashboard save <dashboard-id> [--message <text>]
  dashboard publish <dashboard-id> --revision <revision-id>
  revision list --dashboard <dashboard-id> [--limit <n>]
  revision show <revision-id>
  revision files <revision-id>
  revision read <revision-id> <path>
  revision export <revision-id> [--output <path>] [--force]
  publication list --dashboard <dashboard-id> [--limit <n>]
  publication show <publication-id>
  publication download <publication-id> [--output <path>] [--force]
  share create --publication <publication-id> [--expires <duration>]
  share list --dashboard <dashboard-id> [--limit <n>]
  share show <share-link-id>
  share revoke <share-link-id>
  source list | show <id> | describe <id>
  source add <http|jdbc> --name <name> --config <json-file>
  source rename <id> --name <name> --expected-version <n>
  source update <id> --config <json-file> --expected-version <n>
  source test | activate | enable | disable | delete | restore | refresh <id>
  query list [--source <source-id>]
  query show <query-id>
  query register --config <json-file>
  query test <query-id> [--params <json-file>]
  job list [--dashboard <dashboard-id>]
  job show <job-id>
  job watch <job-id>
  job cancel <job-id>

Global options:
  --api-url <url>  Control Plane URL
  --tenant <id>    Tenant ID (or MDA_TENANT)
  --output <human|json>
  -h, --help
  -V, --version

Environment:
  MDA_TOKEN, MDA_ACCESS_PASSWORD
`;

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

async function readJsonFile(path: string): Promise<unknown> {
  try {
    return JSON.parse(await Bun.file(path).text());
  } catch (error) {
    throw new Error(
      `Cannot read JSON file ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function parseDuration(value: string): number | undefined {
  const match = value.match(/^(\d+)([mhd])$/);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const multiplier = { m: 60, h: 3_600, d: 86_400 }[
    match[2] as "m" | "h" | "d"
  ];
  const seconds = amount * multiplier;
  return Number.isSafeInteger(seconds) && seconds >= 60 && seconds <= 31_536_000
    ? seconds
    : undefined;
}

function printJob(job: AgentJob): void {
  console.log(
    [
      job.id,
      job.purpose,
      job.state,
      job.dashboardId,
      job.sessionId,
      job.createdAt,
    ].join("\t"),
  );
}

function printDashboard(dashboard: Dashboard): void {
  console.log(
    [dashboard.id, dashboard.name, dashboard.status, dashboard.updatedAt].join(
      "\t",
    ),
  );
}

function printFolder(folder: DashboardFolder): void {
  console.log(
    [folder.id, folder.name, folder.parentId ?? "-", `v${folder.version}`].join(
      "\t",
    ),
  );
}

function printRevision(revision: DashboardRevision): void {
  console.log(
    [
      revision.id,
      `r${revision.number}`,
      revision.fileCount,
      revision.totalBytes,
      revision.digest,
      revision.createdAt,
    ].join("\t"),
  );
}

function printPublication(publication: Publication): void {
  console.log(
    [
      publication.id,
      `p${publication.number}`,
      publication.revisionId,
      publication.fileCount,
      publication.totalBytes,
      publication.buildDigest,
      publication.createdAt,
    ].join("\t"),
  );
}

function exitCode(error: ApiClientError): number {
  if (error.status === 401 || error.status === 403) return 3;
  if (error.status === 404 || error.status === 409) return 4;
  if (error.status === 400) return 5;
  return 7;
}

export async function main(args = Bun.argv.slice(2)): Promise<number> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: {
        "api-url": { type: "string" },
        config: { type: "string" },
        dashboard: { type: "string" },
        description: { type: "string" },
        expires: { type: "string" },
        "expected-version": { type: "string" },
        folder: { type: "string" },
        force: { type: "boolean" },
        help: { type: "boolean", short: "h" },
        "idempotency-key": { type: "string" },
        limit: { type: "string" },
        message: { type: "string" },
        name: { type: "string" },
        output: { type: "string" },
        params: { type: "string" },
        parent: { type: "string" },
        publication: { type: "string" },
        revision: { type: "string" },
        root: { type: "boolean" },
        session: { type: "string" },
        source: { type: "string" },
        tenant: { type: "string" },
        version: { type: "boolean", short: "V" },
      },
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }

  if (parsed.values.version) {
    console.log(packageJson.version);
    return 0;
  }
  if (parsed.values.help || parsed.positionals.length === 0) {
    console.log(help);
    return 0;
  }

  const apiUrl =
    stringValue(parsed.values["api-url"]) ??
    process.env.MDA_API_URL ??
    "http://localhost:8080";
  const isArtifactDownload =
    (parsed.positionals[0] === "revision" &&
      parsed.positionals[1] === "export") ||
    (parsed.positionals[0] === "publication" &&
      parsed.positionals[1] === "download");
  const output = isArtifactDownload
    ? (process.env.MDA_OUTPUT ?? "human")
    : (stringValue(parsed.values.output) ?? process.env.MDA_OUTPUT ?? "human");
  if (output !== "human" && output !== "json") {
    console.error("--output must be human or json");
    return 2;
  }

  if (parsed.positionals.length === 1 && parsed.positionals[0] === "doctor") {
    try {
      const response = await fetch(new URL("/api/meta", apiUrl));
      if (!response.ok)
        throw new Error(`Control Plane returned HTTP ${response.status}`);

      const body: unknown = await response.json();
      if (!Value.Check(ServiceMetadataSchema, body)) {
        throw new Error("Control Plane returned incompatible metadata");
      }

      const metadata = body as ServiceMetadata;
      if (output === "json") console.log(JSON.stringify(metadata));
      else {
        console.log(`API: ${apiUrl}`);
        console.log(`Service: ${metadata.service} ${metadata.version}`);
        console.log(`Contract: ${metadata.contractVersion}`);
      }
      return 0;
    } catch (error) {
      console.error(
        `doctor failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 7;
    }
  }

  if (
    parsed.positionals[0] !== "dashboard" &&
    parsed.positionals[0] !== "revision" &&
    parsed.positionals[0] !== "folder" &&
    parsed.positionals[0] !== "publication" &&
    parsed.positionals[0] !== "share" &&
    parsed.positionals[0] !== "source" &&
    parsed.positionals[0] !== "query" &&
    parsed.positionals[0] !== "job" &&
    parsed.positionals[0] !== "chat"
  ) {
    console.error(`Unknown command: ${parsed.positionals.join(" ")}`);
    return 2;
  }

  const config = {
    apiUrl,
    tenant: stringValue(parsed.values.tenant) ?? process.env.MDA_TENANT,
    token: process.env.MDA_TOKEN,
    accessPassword: process.env.MDA_ACCESS_PASSWORD,
    version: packageJson.version,
  };

  try {
    if (parsed.positionals[0] === "chat") {
      if (parsed.positionals.length !== 2) {
        console.error("chat requires a Dashboard ID");
        return 2;
      }
      await chat(
        config,
        parsed.positionals[1] ?? "",
        stringValue(parsed.values.session),
      );
      return 0;
    }

    const action = parsed.positionals[1];
    if (parsed.positionals[0] === "folder") {
      if (action === "list" && parsed.positionals.length === 2) {
        const body = await apiRequest(config, "/api/dashboard-folders");
        if (!Value.Check(DashboardFolderListResponseSchema, body)) {
          throw new Error("Control Plane returned invalid Folder data");
        }
        if (output === "json") console.log(JSON.stringify(body));
        else body.items.forEach(printFolder);
        return 0;
      }

      if (action === "create" && parsed.positionals.length === 2) {
        const name = stringValue(parsed.values.name);
        if (!name) {
          console.error("folder create requires --name");
          return 2;
        }
        const body = await apiRequest(config, "/api/dashboard-folders", {
          method: "POST",
          headers: {
            "idempotency-key":
              stringValue(parsed.values["idempotency-key"]) ??
              crypto.randomUUID(),
          },
          body: JSON.stringify({
            name,
            ...(stringValue(parsed.values.parent)
              ? { parentId: stringValue(parsed.values.parent) }
              : {}),
          }),
        });
        if (!Value.Check(DashboardFolderSchema, body)) {
          throw new Error("Control Plane returned invalid Folder data");
        }
        if (output === "json") console.log(JSON.stringify(body));
        else printFolder(body);
        return 0;
      }

      if (
        ["rename", "move", "delete"].includes(action ?? "") &&
        parsed.positionals.length === 3
      ) {
        const expectedVersion = Number(
          stringValue(parsed.values["expected-version"]),
        );
        if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
          console.error(`folder ${action} requires --expected-version`);
          return 2;
        }
        const folderId = encodeURIComponent(parsed.positionals[2] ?? "");
        if (action === "delete") {
          await apiFetch(config, `/api/dashboard-folders/${folderId}`, {
            method: "DELETE",
            body: JSON.stringify({ expectedVersion }),
          });
          if (output === "json") {
            console.log(
              JSON.stringify({ id: parsed.positionals[2], deleted: true }),
            );
          } else console.log(`${parsed.positionals[2]}\tdeleted`);
          return 0;
        }
        const name = stringValue(parsed.values.name);
        const parentId = stringValue(parsed.values.parent);
        const root = parsed.values.root === true;
        if (action === "rename" && !name) {
          console.error("folder rename requires --name");
          return 2;
        }
        if (action === "move" && Boolean(parentId) === root) {
          console.error(
            "folder move requires exactly one of --parent or --root",
          );
          return 2;
        }
        const body = await apiRequest(
          config,
          `/api/dashboard-folders/${folderId}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              expectedVersion,
              ...(action === "rename" ? { name } : {}),
              ...(action === "move"
                ? { parentId: root ? null : parentId }
                : {}),
            }),
          },
        );
        if (!Value.Check(DashboardFolderSchema, body)) {
          throw new Error("Control Plane returned invalid Folder data");
        }
        if (output === "json") console.log(JSON.stringify(body));
        else printFolder(body);
        return 0;
      }

      console.error(
        `Unknown folder command: ${parsed.positionals.slice(1).join(" ")}`,
      );
      return 2;
    }

    if (parsed.positionals[0] === "revision") {
      if (action === "list" && parsed.positionals.length === 2) {
        const dashboardId = stringValue(parsed.values.dashboard);
        if (!dashboardId) {
          console.error("revision list requires --dashboard");
          return 2;
        }
        const rawLimit = stringValue(parsed.values.limit) ?? "50";
        const limit = Number(rawLimit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
          console.error("--limit must be an integer between 1 and 100");
          return 2;
        }
        const body = await apiRequest(
          config,
          `/api/dashboards/${encodeURIComponent(dashboardId)}/revisions?limit=${limit}`,
        );
        if (!Value.Check(DashboardRevisionListResponseSchema, body)) {
          throw new Error("Control Plane returned invalid Revision data");
        }
        if (output === "json") console.log(JSON.stringify(body));
        else body.items.forEach(printRevision);
        return 0;
      }

      if (action === "show" && parsed.positionals.length === 3) {
        const body = await apiRequest(
          config,
          `/api/revisions/${encodeURIComponent(parsed.positionals[2] ?? "")}`,
        );
        if (!Value.Check(DashboardRevisionSchema, body)) {
          throw new Error("Control Plane returned invalid Revision data");
        }
        if (output === "json") console.log(JSON.stringify(body));
        else printRevision(body);
        return 0;
      }

      if (action === "files" && parsed.positionals.length === 3) {
        const body = await apiRequest(
          config,
          `/api/revisions/${encodeURIComponent(parsed.positionals[2] ?? "")}/files`,
        );
        if (!Value.Check(DashboardRevisionFileListResponseSchema, body)) {
          throw new Error("Control Plane returned invalid Revision files");
        }
        if (output === "json") console.log(JSON.stringify(body));
        else {
          for (const file of body.items) {
            console.log(
              [
                file.path,
                file.size,
                file.digest,
                file.executable ? "x" : "-",
              ].join("\t"),
            );
          }
        }
        return 0;
      }

      if (action === "read" && parsed.positionals.length === 4) {
        const response = await apiFetch(
          config,
          `/api/revisions/${encodeURIComponent(parsed.positionals[2] ?? "")}/files/${encodeURIComponent(parsed.positionals[3] ?? "")}`,
        );
        process.stdout.write(Buffer.from(await response.arrayBuffer()));
        return 0;
      }

      if (action === "export" && parsed.positionals.length === 3) {
        const revisionId = parsed.positionals[2] ?? "";
        const path =
          stringValue(parsed.values.output) ?? `${revisionId}.tar.gz`;
        if (existsSync(path) && !parsed.values.force) {
          console.error(`Refusing to overwrite existing file: ${path}`);
          return 4;
        }
        const response = await apiFetch(
          config,
          `/api/revisions/${encodeURIComponent(revisionId)}/export`,
        );
        const temporary = `${path}.tmp-${crypto.randomUUID()}`;
        try {
          await Bun.write(temporary, response);
          await rename(temporary, path);
        } finally {
          await rm(temporary, { force: true });
        }
        console.log(path);
        return 0;
      }

      console.error(
        `Unknown revision command: ${parsed.positionals.slice(1).join(" ")}`,
      );
      return 2;
    }

    if (parsed.positionals[0] === "publication") {
      if (action === "list" && parsed.positionals.length === 2) {
        const dashboardId = stringValue(parsed.values.dashboard);
        if (!dashboardId) {
          console.error("publication list requires --dashboard");
          return 2;
        }
        const rawLimit = stringValue(parsed.values.limit) ?? "50";
        const limit = Number(rawLimit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
          console.error("--limit must be an integer between 1 and 100");
          return 2;
        }
        const body = await apiRequest(
          config,
          `/api/dashboards/${encodeURIComponent(dashboardId)}/publications?limit=${limit}`,
        );
        if (!Value.Check(PublicationListResponseSchema, body)) {
          throw new Error("Control Plane returned invalid Publication data");
        }
        if (output === "json") console.log(JSON.stringify(body));
        else body.items.forEach(printPublication);
        return 0;
      }

      if (action === "show" && parsed.positionals.length === 3) {
        const body = await apiRequest(
          config,
          `/api/publications/${encodeURIComponent(parsed.positionals[2] ?? "")}`,
        );
        if (!Value.Check(PublicationSchema, body)) {
          throw new Error("Control Plane returned invalid Publication data");
        }
        if (output === "json") console.log(JSON.stringify(body));
        else printPublication(body);
        return 0;
      }

      if (action === "download" && parsed.positionals.length === 3) {
        const publicationId = parsed.positionals[2] ?? "";
        const path =
          stringValue(parsed.values.output) ?? `${publicationId}.tar.gz`;
        if (existsSync(path) && !parsed.values.force) {
          console.error(`Refusing to overwrite existing file: ${path}`);
          return 4;
        }
        const response = await apiFetch(
          config,
          `/api/publications/${encodeURIComponent(publicationId)}/export`,
        );
        const temporary = `${path}.tmp-${crypto.randomUUID()}`;
        try {
          await Bun.write(temporary, response);
          await rename(temporary, path);
        } finally {
          await rm(temporary, { force: true });
        }
        console.log(path);
        return 0;
      }

      console.error(
        `Unknown publication command: ${parsed.positionals.slice(1).join(" ")}`,
      );
      return 2;
    }

    if (parsed.positionals[0] === "share") {
      if (action === "create" && parsed.positionals.length === 2) {
        const publicationId = stringValue(parsed.values.publication);
        if (!publicationId) {
          console.error("share create requires --publication");
          return 2;
        }
        const rawExpires = stringValue(parsed.values.expires);
        const expiresInSeconds = rawExpires
          ? parseDuration(rawExpires)
          : undefined;
        if (rawExpires && !expiresInSeconds) {
          console.error("--expires must be between 1m and 365d");
          return 2;
        }
        const body = await apiRequest(
          config,
          `/api/publications/${encodeURIComponent(publicationId)}/share-links`,
          {
            method: "POST",
            headers: {
              "idempotency-key":
                stringValue(parsed.values["idempotency-key"]) ??
                crypto.randomUUID(),
            },
            body: JSON.stringify({
              ...(expiresInSeconds ? { expiresInSeconds } : {}),
            }),
          },
        );
        if (!Value.Check(CreateShareLinkResponseSchema, body)) {
          throw new Error("Control Plane returned invalid Share Link data");
        }
        if (output === "json") console.log(JSON.stringify(body));
        else console.log(body.url);
        return 0;
      }

      if (action === "list" && parsed.positionals.length === 2) {
        const dashboardId = stringValue(parsed.values.dashboard);
        if (!dashboardId) {
          console.error("share list requires --dashboard");
          return 2;
        }
        const rawLimit = stringValue(parsed.values.limit) ?? "50";
        const limit = Number(rawLimit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
          console.error("--limit must be an integer between 1 and 100");
          return 2;
        }
        const body = await apiRequest(
          config,
          `/api/dashboards/${encodeURIComponent(dashboardId)}/share-links?limit=${limit}`,
        );
        if (!Value.Check(ShareLinkListResponseSchema, body)) {
          throw new Error("Control Plane returned invalid Share Link data");
        }
        if (output === "json") console.log(JSON.stringify(body));
        else {
          for (const link of body.items) {
            console.log(
              [
                link.id,
                link.publicationId,
                link.status,
                link.expiresAt ?? "-",
                link.createdAt,
              ].join("\t"),
            );
          }
        }
        return 0;
      }

      if (action === "show" && parsed.positionals.length === 3) {
        const body = await apiRequest(
          config,
          `/api/share-links/${encodeURIComponent(parsed.positionals[2] ?? "")}`,
        );
        if (!Value.Check(ShareLinkSchema, body)) {
          throw new Error("Control Plane returned invalid Share Link data");
        }
        if (output === "json") console.log(JSON.stringify(body));
        else {
          console.log(
            [
              body.id,
              body.publicationId,
              body.status,
              body.expiresAt ?? "-",
              body.createdAt,
            ].join("\t"),
          );
        }
        return 0;
      }

      if (action === "revoke" && parsed.positionals.length === 3) {
        const body = await apiRequest(
          config,
          `/api/share-links/${encodeURIComponent(parsed.positionals[2] ?? "")}/revoke`,
          { method: "POST", body: JSON.stringify({}) },
        );
        if (!Value.Check(ShareLinkSchema, body)) {
          throw new Error("Control Plane returned invalid Share Link data");
        }
        if (output === "json") console.log(JSON.stringify(body));
        else console.log(`${body.id}\t${body.status}`);
        return 0;
      }

      console.error(
        `Unknown share command: ${parsed.positionals.slice(1).join(" ")}`,
      );
      return 2;
    }

    if (parsed.positionals[0] === "job") {
      if (action === "list" && parsed.positionals.length === 2) {
        const dashboardId = stringValue(parsed.values.dashboard);
        const body = await apiRequest(
          config,
          `/api/agent-jobs?limit=50${dashboardId ? `&dashboardId=${encodeURIComponent(dashboardId)}` : ""}`,
        );
        if (!Value.Check(AgentJobListResponseSchema, body)) {
          throw new Error("Control Plane returned invalid Agent Job data");
        }
        if (output === "json") console.log(JSON.stringify(body));
        else body.items.forEach(printJob);
        return 0;
      }
      if (
        ["show", "watch", "cancel"].includes(action ?? "") &&
        parsed.positionals.length === 3
      ) {
        const jobId = parsed.positionals[2] ?? "";
        if (action === "cancel") {
          const body = await apiRequest(
            config,
            `/api/agent-jobs/${encodeURIComponent(jobId)}/cancel`,
            { method: "POST", body: JSON.stringify({}) },
          );
          if (!Value.Check(AgentJobSchema, body)) {
            throw new Error("Control Plane returned invalid Agent Job data");
          }
          if (output === "json") console.log(JSON.stringify(body));
          else printJob(body);
          return 0;
        }
        const body = await apiRequest(
          config,
          `/api/agent-jobs/${encodeURIComponent(jobId)}`,
        );
        if (!Value.Check(AgentJobSchema, body)) {
          throw new Error("Control Plane returned invalid Agent Job data");
        }
        if (action === "watch") {
          const final = await watchJob(config, body);
          if (output === "json") console.log(JSON.stringify(final));
          return ["failed", "cancelled"].includes(final.state) ? 6 : 0;
        }
        if (output === "json") console.log(JSON.stringify(body));
        else printJob(body);
        return 0;
      }
      console.error(
        `Unknown job command: ${parsed.positionals.slice(1).join(" ")}`,
      );
      return 2;
    }

    if (parsed.positionals[0] === "source") {
      if (action === "list" && parsed.positionals.length === 2) {
        const body = await apiRequest(config, "/api/data-sources");
        if (!Value.Check(DataSourceListResponseSchema, body)) {
          throw new Error("Control Plane returned invalid Data Source data");
        }
        if (output === "json") console.log(JSON.stringify(body));
        else {
          for (const source of body.items) {
            console.log(
              [
                source.id,
                source.name,
                source.kind,
                source.status,
                source.health,
                `v${source.version}`,
              ].join("\t"),
            );
          }
        }
        return 0;
      }
      if (
        (action === "show" || action === "describe") &&
        parsed.positionals.length === 3
      ) {
        const id = parsed.positionals[2] ?? "";
        const body = await apiRequest(
          config,
          `/api/data-sources/${encodeURIComponent(id)}${action === "describe" ? "/description" : ""}`,
        );
        const schema =
          action === "describe"
            ? DataSourceDescriptionSchema
            : DataSourceSchema;
        if (!Value.Check(schema, body)) {
          throw new Error("Control Plane returned invalid Data Source data");
        }
        console.log(JSON.stringify(body, null, output === "json" ? 0 : 2));
        return 0;
      }
      if (
        action === "add" &&
        ["http", "jdbc"].includes(parsed.positionals[2] ?? "")
      ) {
        const name = stringValue(parsed.values.name);
        const configPath = stringValue(parsed.values.config);
        if (!name || !configPath) {
          console.error("source add requires a kind, --name, and --config");
          return 2;
        }
        const file = (await readJsonFile(configPath)) as Record<
          string,
          unknown
        >;
        const sourceConfig =
          file && typeof file === "object" && "config" in file
            ? file.config
            : file;
        const body = await apiRequest(config, "/api/data-sources", {
          method: "POST",
          headers: {
            "idempotency-key":
              stringValue(parsed.values["idempotency-key"]) ??
              crypto.randomUUID(),
          },
          body: JSON.stringify({
            name,
            ...(stringValue(parsed.values.description)
              ? { description: stringValue(parsed.values.description) }
              : {}),
            kind: parsed.positionals[2],
            config: sourceConfig,
            ...(file && typeof file === "object" && Array.isArray(file.entities)
              ? { entities: file.entities }
              : {}),
          }),
        });
        if (!Value.Check(DataSourceSchema, body)) {
          throw new Error("Control Plane returned invalid Data Source data");
        }
        if (output === "json") console.log(JSON.stringify(body));
        else console.log(`${body.id}\t${body.name}\t${body.status}`);
        return 0;
      }
      if (action === "rename" && parsed.positionals.length === 3) {
        const name = stringValue(parsed.values.name);
        const expectedVersion = Number(
          stringValue(parsed.values["expected-version"]),
        );
        if (
          !name ||
          !Number.isInteger(expectedVersion) ||
          expectedVersion < 1
        ) {
          console.error("source rename requires --name and --expected-version");
          return 2;
        }
        const body = await apiRequest(
          config,
          `/api/data-sources/${encodeURIComponent(parsed.positionals[2] ?? "")}/rename`,
          {
            method: "POST",
            body: JSON.stringify({ name, expectedVersion }),
          },
        );
        if (!Value.Check(DataSourceSchema, body)) {
          throw new Error("Control Plane returned invalid Data Source data");
        }
        console.log(
          output === "json"
            ? JSON.stringify(body)
            : `${body.id}\t${body.name}\tv${body.version}`,
        );
        return 0;
      }
      if (action === "update" && parsed.positionals.length === 3) {
        const configPath = stringValue(parsed.values.config);
        const expectedVersion = Number(
          stringValue(parsed.values["expected-version"]),
        );
        if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
          console.error("source update requires --expected-version");
          return 2;
        }
        const file = configPath
          ? ((await readJsonFile(configPath)) as Record<string, unknown>)
          : undefined;
        const body = await apiRequest(
          config,
          `/api/data-sources/${encodeURIComponent(parsed.positionals[2] ?? "")}/update`,
          {
            method: "POST",
            body: JSON.stringify({
              expectedVersion,
              ...(stringValue(parsed.values.description)
                ? { description: stringValue(parsed.values.description) }
                : {}),
              ...(file
                ? {
                    config: "config" in file ? file.config : file,
                    ...(Array.isArray(file.entities)
                      ? { entities: file.entities }
                      : {}),
                  }
                : {}),
            }),
          },
        );
        if (!Value.Check(DataSourceSchema, body)) {
          throw new Error("Control Plane returned invalid Data Source data");
        }
        console.log(
          output === "json"
            ? JSON.stringify(body)
            : `${body.id}\tv${body.version}`,
        );
        return 0;
      }
      if (
        [
          "test",
          "activate",
          "enable",
          "disable",
          "delete",
          "restore",
          "refresh",
        ].includes(action ?? "") &&
        parsed.positionals.length === 3
      ) {
        const remoteAction = action === "refresh" ? "schema-refresh" : action;
        const body = await apiRequest(
          config,
          `/api/data-sources/${encodeURIComponent(parsed.positionals[2] ?? "")}/${remoteAction}`,
          { method: "POST", body: JSON.stringify({}) },
        );
        const schema =
          action === "test"
            ? DataSourceTestResultSchema
            : action === "refresh"
              ? DataSourceDescriptionSchema
              : DataSourceSchema;
        if (!Value.Check(schema, body)) {
          throw new Error("Control Plane returned invalid Data Source data");
        }
        console.log(JSON.stringify(body, null, output === "json" ? 0 : 2));
        return 0;
      }
      console.error(
        `Unknown source command: ${parsed.positionals.slice(1).join(" ")}`,
      );
      return 2;
    }

    if (parsed.positionals[0] === "query") {
      if (action === "list" && parsed.positionals.length === 2) {
        const sourceId = stringValue(parsed.values.source);
        const body = await apiRequest(
          config,
          `/api/queries${sourceId ? `?sourceId=${encodeURIComponent(sourceId)}` : ""}`,
        );
        if (!Value.Check(RegisteredQueryListResponseSchema, body)) {
          throw new Error("Control Plane returned invalid Query data");
        }
        if (output === "json") console.log(JSON.stringify(body));
        else {
          for (const query of body.items) {
            console.log(
              [
                query.id,
                `r${query.revision}`,
                query.name,
                query.sourceId,
                query.public ? "public" : "private",
              ].join("\t"),
            );
          }
        }
        return 0;
      }
      if (action === "show" && parsed.positionals.length === 3) {
        const body = await apiRequest(
          config,
          `/api/queries/${encodeURIComponent(parsed.positionals[2] ?? "")}`,
        );
        if (!Value.Check(RegisteredQuerySchema, body)) {
          throw new Error("Control Plane returned invalid Query data");
        }
        console.log(JSON.stringify(body, null, output === "json" ? 0 : 2));
        return 0;
      }
      if (action === "register" && parsed.positionals.length === 2) {
        const configPath = stringValue(parsed.values.config);
        if (!configPath) {
          console.error("query register requires --config");
          return 2;
        }
        const body = await apiRequest(config, "/api/queries", {
          method: "POST",
          headers: {
            "idempotency-key":
              stringValue(parsed.values["idempotency-key"]) ??
              crypto.randomUUID(),
          },
          body: JSON.stringify(await readJsonFile(configPath)),
        });
        if (!Value.Check(RegisteredQuerySchema, body)) {
          throw new Error("Control Plane returned invalid Query data");
        }
        if (output === "json") console.log(JSON.stringify(body));
        else console.log(`${body.id}\tr${body.revision}\t${body.name}`);
        return 0;
      }
      if (action === "test" && parsed.positionals.length === 3) {
        const paramsPath = stringValue(parsed.values.params);
        const body = await apiRequest(
          config,
          `/api/queries/${encodeURIComponent(parsed.positionals[2] ?? "")}/execute`,
          {
            method: "POST",
            body: JSON.stringify({
              parameters: paramsPath ? await readJsonFile(paramsPath) : {},
            }),
          },
        );
        if (!Value.Check(QueryResultSchema, body)) {
          throw new Error("Control Plane returned invalid Query result");
        }
        console.log(JSON.stringify(body, null, output === "json" ? 0 : 2));
        return 0;
      }
      console.error(
        `Unknown query command: ${parsed.positionals.slice(1).join(" ")}`,
      );
      return 2;
    }

    if (action === "list" && parsed.positionals.length === 2) {
      const rawLimit = stringValue(parsed.values.limit) ?? "50";
      const limit = Number(rawLimit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        console.error("--limit must be an integer between 1 and 100");
        return 2;
      }
      const body = await apiRequest(config, `/api/dashboards?limit=${limit}`);
      if (!Value.Check(DashboardListResponseSchema, body)) {
        throw new Error("Control Plane returned invalid Dashboard data");
      }
      if (output === "json") console.log(JSON.stringify(body));
      else body.items.forEach(printDashboard);
      return 0;
    }

    if (action === "create" && parsed.positionals.length === 2) {
      const name = stringValue(parsed.values.name);
      if (!name) {
        console.error("dashboard create requires --name");
        return 2;
      }
      const body = await apiRequest(config, "/api/dashboards", {
        method: "POST",
        headers: {
          "idempotency-key":
            stringValue(parsed.values["idempotency-key"]) ??
            crypto.randomUUID(),
        },
        body: JSON.stringify({
          name,
          ...(stringValue(parsed.values.description)
            ? { description: stringValue(parsed.values.description) }
            : {}),
          ...(stringValue(parsed.values.folder)
            ? { folderId: stringValue(parsed.values.folder) }
            : {}),
        }),
      });
      if (!Value.Check(DashboardSchema, body)) {
        throw new Error("Control Plane returned invalid Dashboard data");
      }
      if (output === "json") console.log(JSON.stringify(body));
      else printDashboard(body);
      return 0;
    }

    if (
      (action === "update" || action === "archive") &&
      parsed.positionals.length === 3
    ) {
      const expectedVersion = Number(
        stringValue(parsed.values["expected-version"]),
      );
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
        console.error(`dashboard ${action} requires --expected-version`);
        return 2;
      }
      if (
        action === "update" &&
        parsed.values.root === true &&
        stringValue(parsed.values.folder)
      ) {
        console.error(
          "dashboard update accepts only one of --folder or --root",
        );
        return 2;
      }
      const body = await apiRequest(
        config,
        `/api/dashboards/${encodeURIComponent(parsed.positionals[2] ?? "")}${action === "archive" ? "/archive" : ""}`,
        {
          method: action === "archive" ? "POST" : "PATCH",
          body: JSON.stringify({
            expectedVersion,
            ...(action === "update" && stringValue(parsed.values.name)
              ? { name: stringValue(parsed.values.name) }
              : {}),
            ...(action === "update" &&
            stringValue(parsed.values.description) !== undefined
              ? { description: stringValue(parsed.values.description) }
              : {}),
            ...(action === "update" && stringValue(parsed.values.folder)
              ? { folderId: stringValue(parsed.values.folder) }
              : {}),
            ...(action === "update" && parsed.values.root === true
              ? { folderId: null }
              : {}),
          }),
        },
      );
      if (!Value.Check(DashboardSchema, body)) {
        throw new Error("Control Plane returned invalid Dashboard data");
      }
      if (output === "json") console.log(JSON.stringify(body));
      else printDashboard(body);
      return 0;
    }

    if (action === "preview" && parsed.positionals.length === 3) {
      const dashboardId = parsed.positionals[2] ?? "";
      const created = await apiRequest(
        config,
        `/api/dashboards/${encodeURIComponent(dashboardId)}/previews`,
        {
          method: "POST",
          headers: {
            "idempotency-key":
              stringValue(parsed.values["idempotency-key"]) ??
              crypto.randomUUID(),
          },
          body: JSON.stringify({
            ...(stringValue(parsed.values.revision)
              ? { revisionId: stringValue(parsed.values.revision) }
              : {}),
          }),
        },
      );
      if (!Value.Check(CreateDashboardPreviewResponseSchema, created)) {
        throw new Error("Control Plane returned invalid Preview data");
      }
      const job = await watchJob(config, created.job);
      if (job.state !== "succeeded") return 5;
      const preview = await apiRequest(
        config,
        `/api/previews/${encodeURIComponent(created.preview.id)}`,
      );
      if (!Value.Check(DashboardPreviewSchema, preview)) {
        throw new Error("Control Plane returned invalid Preview data");
      }
      if (preview.status !== "ready") {
        console.error(`Preview is ${preview.status}`);
        return 5;
      }
      if (output === "json") console.log(JSON.stringify(preview));
      else console.log(preview.url);
      return 0;
    }

    if (action === "publish" && parsed.positionals.length === 3) {
      const revisionId = stringValue(parsed.values.revision);
      if (!revisionId) {
        console.error("dashboard publish requires --revision");
        return 2;
      }
      const dashboardId = parsed.positionals[2] ?? "";
      const created = await apiRequest(
        config,
        `/api/dashboards/${encodeURIComponent(dashboardId)}/publications`,
        {
          method: "POST",
          headers: {
            "idempotency-key":
              stringValue(parsed.values["idempotency-key"]) ??
              crypto.randomUUID(),
          },
          body: JSON.stringify({ revisionId }),
        },
      );
      if (!Value.Check(CreatePublicationResponseSchema, created)) {
        throw new Error("Control Plane returned invalid Publication data");
      }
      const job = await watchJob(config, created.job);
      if (job.state !== "succeeded") return 5;
      const build = await apiRequest(
        config,
        `/api/publication-builds/${encodeURIComponent(created.build.id)}`,
      );
      if (!Value.Check(PublicationBuildSchema, build)) {
        throw new Error("Control Plane returned invalid Publication Build");
      }
      if (build.status !== "ready" || !build.publicationId) {
        console.error(`Publication Build is ${build.status}`);
        return 5;
      }
      const publication = await apiRequest(
        config,
        `/api/publications/${encodeURIComponent(build.publicationId)}`,
      );
      if (!Value.Check(PublicationSchema, publication)) {
        throw new Error("Control Plane returned invalid Publication data");
      }
      if (output === "json") console.log(JSON.stringify(publication));
      else printPublication(publication);
      return 0;
    }

    if (action === "save" && parsed.positionals.length === 3) {
      const body = await apiRequest(
        config,
        `/api/dashboards/${encodeURIComponent(parsed.positionals[2] ?? "")}/revisions`,
        {
          method: "POST",
          headers: { "idempotency-key": crypto.randomUUID() },
          body: JSON.stringify({
            ...(stringValue(parsed.values.message)
              ? { message: stringValue(parsed.values.message) }
              : {}),
          }),
        },
      );
      if (!Value.Check(DashboardRevisionSchema, body)) {
        throw new Error("Control Plane returned invalid Revision data");
      }
      if (output === "json") console.log(JSON.stringify(body));
      else printRevision(body);
      return 0;
    }

    if (action === "show" && parsed.positionals.length === 3) {
      const body = await apiRequest(
        config,
        `/api/dashboards/${encodeURIComponent(parsed.positionals[2] ?? "")}`,
      );
      if (!Value.Check(DashboardSchema, body)) {
        throw new Error("Control Plane returned invalid Dashboard data");
      }
      if (output === "json") console.log(JSON.stringify(body));
      else printDashboard(body);
      return 0;
    }

    console.error(
      `Unknown dashboard command: ${parsed.positionals.slice(1).join(" ")}`,
    );
    return 2;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return error instanceof ApiClientError ? exitCode(error) : 7;
  }
}

if (import.meta.main) process.exitCode = await main();
