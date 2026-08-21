#!/usr/bin/env bun

import { parseArgs } from "node:util";
import { type ServiceMetadata, ServiceMetadataSchema } from "@mda/contracts";
import { Value } from "@sinclair/typebox/value";
import packageJson from "../package.json" with { type: "json" };

const help = `mda ${packageJson.version}

Usage:
  mda [--api-url <url>] <command>

Commands:
  doctor       Check Control Plane reachability and compatibility

Options:
  --api-url    Control Plane URL (default: MDA_API_URL or http://localhost:8080)
  -h, --help   Show help
  -V, --version  Show version
`;

export async function main(args = Bun.argv.slice(2)): Promise<number> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: {
        "api-url": { type: "string" },
        help: { type: "boolean", short: "h" },
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
  if (parsed.positionals.length !== 1 || parsed.positionals[0] !== "doctor") {
    console.error(`Unknown command: ${parsed.positionals.join(" ")}`);
    return 2;
  }

  const configuredApiUrl = parsed.values["api-url"];
  const apiUrl =
    (typeof configuredApiUrl === "string" ? configuredApiUrl : undefined) ??
    process.env.MDA_API_URL ??
    "http://localhost:8080";

  try {
    const response = await fetch(new URL("/api/meta", apiUrl));
    if (!response.ok)
      throw new Error(`Control Plane returned HTTP ${response.status}`);

    const body: unknown = await response.json();
    if (!Value.Check(ServiceMetadataSchema, body)) {
      throw new Error("Control Plane returned incompatible metadata");
    }

    const metadata = body as ServiceMetadata;
    console.log(`API: ${apiUrl}`);
    console.log(`Service: ${metadata.service} ${metadata.version}`);
    console.log(`Contract: ${metadata.contractVersion}`);
    return 0;
  } catch (error) {
    console.error(
      `doctor failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 7;
  }
}

if (import.meta.main) process.exitCode = await main();
