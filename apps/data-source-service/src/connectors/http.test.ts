import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RegisteredQuery } from "@mda/contracts";
import { createHttpConnector, validateDestination } from "./http.ts";

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

const connector = createHttpConnector("/run/secrets");

afterAll(() => server.stop(true));

test("implements the common snapshot connector contract", async () => {
  expect(connector.kind).toBe("http");
  expect(connector.capabilities).toMatchObject({
    schema: "declared",
    snapshotRead: "native",
    incrementalRead: "unsupported",
  });
  expect(
    (
      await connector.testConnection({
        sourceId: "source_http",
        config,
      })
    ).latencyMs,
  ).toBeGreaterThanOrEqual(0);
  const result = await connector.execute({
    sourceId: "source_http",
    config,
    query,
    parameters: { region: "APAC" },
  });
  expect(result.rows).toEqual([{ region: "APAC", revenue: 125_000 }]);
  expect(result.meta.columns.map(({ name }) => name)).toEqual([
    "region",
    "revenue",
  ]);
  expect(result.meta.cache.hit).toBe(false);

  const entities = [
    {
      name: "sales",
      fields: [{ name: "region", type: "string" as const, nullable: false }],
    },
  ];
  expect(
    await connector.describe({
      sourceId: "source_http",
      config,
      declaredEntities: entities,
    }),
  ).toEqual({ entities });
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
  const authenticatedConnector = createHttpConnector(root);
  try {
    expect(
      (
        await authenticatedConnector.testConnection({
          sourceId: "source_authenticated",
          config: authenticatedConfig,
        })
      ).latencyMs,
    ).toBeGreaterThanOrEqual(0);
    const result = await authenticatedConnector.execute({
      sourceId: "source_authenticated",
      config: authenticatedConfig,
      query: {
        ...query,
        operation: {
          method: "GET",
          path: "/",
          query: {},
          rowsPointer: "/rows",
          readOnly: true,
        },
      },
      parameters: { region: "APAC" },
    });
    expect(result.rows).toEqual([{ status: "authorized" }]);
  } finally {
    authenticated.stop(true);
    await rm(root, { recursive: true, force: true });
  }
});

test("blocks invalid configurations, destinations, and parameters", async () => {
  expect(() =>
    connector.validateConfig({
      driverId: "postgresql",
      jdbcUrl: "jdbc:postgresql://database/mda",
    }),
  ).toThrow("Invalid HTTP connector configuration");
  expect(() =>
    connector.validateConfig({ ...config, baseUrl: "not a URL" }),
  ).toThrow("Invalid HTTP base URL");
  await expect(
    validateDestination({ ...config, allowPrivateNetwork: false }),
  ).rejects.toThrow("HTTPS is required");
  await expect(
    connector.execute({
      sourceId: "source_http",
      config,
      query,
      parameters: {},
    }),
  ).rejects.toThrow("Missing region");
});
