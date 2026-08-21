#!/usr/bin/env bun

import { parseArgs } from "node:util";
import {
  type Dashboard,
  DashboardListResponseSchema,
  DashboardSchema,
  type ServiceMetadata,
  ServiceMetadataSchema,
} from "@mda/contracts";
import { Value } from "@sinclair/typebox/value";
import packageJson from "../package.json" with { type: "json" };
import { ApiClientError, apiRequest } from "./client/api.ts";
import { chat } from "./interactive/chat.ts";

const help = `mda ${packageJson.version}

Usage:
  mda [global options] <command> [subcommand] [arguments]

Commands:
  doctor
  chat <dashboard-id>
  dashboard list [--limit <n>]
  dashboard create --name <name> [--description <text>] [--idempotency-key <key>]
  dashboard show <dashboard-id>

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

function printDashboard(dashboard: Dashboard): void {
  console.log(
    [dashboard.id, dashboard.name, dashboard.status, dashboard.updatedAt].join(
      "\t",
    ),
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
        description: { type: "string" },
        help: { type: "boolean", short: "h" },
        "idempotency-key": { type: "string" },
        limit: { type: "string" },
        name: { type: "string" },
        output: { type: "string" },
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
  const output =
    stringValue(parsed.values.output) ?? process.env.MDA_OUTPUT ?? "human";
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
      await chat(config, parsed.positionals[1] ?? "");
      return 0;
    }

    const action = parsed.positionals[1];
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
        }),
      });
      if (!Value.Check(DashboardSchema, body)) {
        throw new Error("Control Plane returned invalid Dashboard data");
      }
      if (output === "json") console.log(JSON.stringify(body));
      else printDashboard(body);
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
