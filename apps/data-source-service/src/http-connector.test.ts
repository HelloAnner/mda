import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RegisteredQuery } from "@mda/contracts";
import {
  executeHttpQuery,
  testHttpSource,
  validateDestination,
} from "./http-connector.ts";

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  routes: {
    "/": () => Response.json({ status: "ok" }),
    "/rows": (request) => {
      const region = new URL(request.url).searchParams.get("region");
      return Response.json({ data: [{ region, revenue: 125_000 }] });
    },
  },
});

const config = {
  baseUrl: `http://127.0.0.1:${server.port}`,
  allowPrivateNetwork: true,
  timeoutMs: 2_000,
  maxResponseBytes: 100_000,
};

const query: Pick<RegisteredQuery, "operation" | "parameters" | "columns"> = {
  operation: {
    method: "GET",
    path: "/rows",
    query: { region: "region" },
    rowsPointer: "/data",
    readOnly: true,
  },
  parameters: [{ name: "region", type: "string", required: true }],
  columns: [],
};

afterAll(() => server.stop(true));

test("executes bounded parameterized HTTP JSON operations", async () => {
  expect((await testHttpSource(config)).latencyMs).toBeGreaterThanOrEqual(0);
  const result = await executeHttpQuery(config, query, { region: "APAC" });
  expect(result.rows).toEqual([{ region: "APAC", revenue: 125_000 }]);
  expect(result.meta.columns.map(({ name }) => name)).toEqual([
    "region",
    "revenue",
  ]);
  expect(result.meta.cache.hit).toBe(false);
});

test("resolves bearer authentication without storing its value", async () => {
  const root = await mkdtemp(join(tmpdir(), "mda-http-secrets-"));
  await writeFile(join(root, "mock-read-token"), "secret-token\n", {
    mode: 0o600,
  });
  const authenticated = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    routes: {
      "/": (request) =>
        request.headers.get("authorization") === "Bearer secret-token"
          ? Response.json({ rows: [{ status: "authorized" }] })
          : Response.json({ error: "unauthorized" }, { status: 401 }),
    },
  });
  const authenticatedConfig = {
    ...config,
    baseUrl: `http://127.0.0.1:${authenticated.port}`,
    auth: { type: "bearer" as const, secretRef: "mock-read-token" },
  };
  try {
    expect(
      (await testHttpSource(authenticatedConfig, root)).latencyMs,
    ).toBeGreaterThanOrEqual(0);
    const result = await executeHttpQuery(
      authenticatedConfig,
      {
        ...query,
        operation: {
          ...query.operation,
          path: "/",
          query: {},
          rowsPointer: "/rows",
        },
      },
      { region: "APAC" },
      undefined,
      root,
    );
    expect(result.rows).toEqual([{ status: "authorized" }]);
  } finally {
    authenticated.stop(true);
    await rm(root, { recursive: true, force: true });
  }
});

test("blocks private destinations unless explicitly approved", async () => {
  await expect(
    validateDestination({ ...config, allowPrivateNetwork: false }),
  ).rejects.toThrow("HTTPS is required");
  await expect(executeHttpQuery(config, query, {})).rejects.toThrow(
    "Missing region",
  );
});
