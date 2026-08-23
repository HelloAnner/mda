import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RegisteredQuery } from "@mda/contracts";
import { createJdbcConnector } from "./jdbc.ts";

let secretsRoot = "";
const requests: Array<Record<string, unknown>> = [];
const token = "t".repeat(32);
const runner = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    if (request.headers.get("authorization") !== `Bearer ${token}`) {
      return Response.json(
        { code: "UNAUTHENTICATED", message: "Invalid token" },
        { status: 401 },
      );
    }
    const body = (await request.json()) as Record<string, unknown>;
    const parameters = Array.isArray(body.parameters) ? body.parameters : [];
    requests.push(body);
    if (new URL(request.url).pathname === "/v1/test") {
      return Response.json({ rows: [], columns: [], durationMs: 3 });
    }
    return Response.json({
      rows: [{ region: parameters[0], revenue: "125000.00" }],
      columns: [
        { name: "region", type: "string", nullable: false },
        { name: "revenue", type: "string", nullable: false },
      ],
      durationMs: 5,
    });
  },
});

const config = {
  driverId: "postgresql" as const,
  jdbcUrl: "jdbc:postgresql://database/mda",
  usernameRef: "username",
  passwordRef: "password",
  connectionTimeoutMs: 2_000,
  statementTimeoutMs: 5_000,
  maxRows: 100,
};

const sql = "SELECT region, revenue FROM sales WHERE region = ?";
const query: Pick<RegisteredQuery, "operation" | "parameters" | "columns"> = {
  operation: {
    sql,
    readOnly: true,
  },
  parameters: [{ name: "region", type: "string", required: true }],
  columns: [],
};

beforeAll(async () => {
  secretsRoot = await mkdtemp(join(tmpdir(), "mda-jdbc-secrets-"));
  await Promise.all([
    writeFile(join(secretsRoot, "username"), "reader\n", { mode: 0o600 }),
    writeFile(join(secretsRoot, "password"), "secret\n", { mode: 0o600 }),
  ]);
});

afterAll(async () => {
  runner.stop(true);
  await rm(secretsRoot, { recursive: true, force: true });
});

test("implements the common snapshot connector contract", async () => {
  const connector = createJdbcConnector({
    runnerUrl: `http://127.0.0.1:${runner.port}`,
    runnerToken: token,
    secretsRoot,
  });
  expect(connector.kind).toBe("jdbc");
  expect(connector.capabilities).toMatchObject({
    schema: "declared",
    snapshotRead: "native",
    incrementalRead: "unsupported",
  });
  expect(
    await connector.testConnection({ sourceId: "source_jdbc", config }),
  ).toEqual({ latencyMs: 3 });

  const result = await connector.execute({
    sourceId: "source_jdbc",
    config,
    query,
    parameters: { region: "APAC" },
  });
  expect(result.rows).toEqual([{ region: "APAC", revenue: "125000.00" }]);
  expect(result.meta.rowCount).toBe(1);
  expect(requests.at(-1)).toMatchObject({
    username: "reader",
    password: "secret",
    sql,
    parameters: ["APAC"],
  });

  const entities = [
    {
      name: "sales",
      fields: [{ name: "region", type: "string" as const, nullable: false }],
    },
  ];
  expect(
    await connector.describe({
      sourceId: "source_jdbc",
      config,
      declaredEntities: entities,
    }),
  ).toEqual({ entities });
});

test("rejects invalid configuration, operations, and parameters", async () => {
  const connector = createJdbcConnector({
    runnerUrl: `http://127.0.0.1:${runner.port}`,
    runnerToken: token,
    secretsRoot,
  });
  expect(() =>
    connector.validateConfig({
      ...config,
      jdbcUrl: "jdbc:postgresql://reader:secret@database/mda",
    }),
  ).toThrow("JDBC URL must not contain credentials");
  await expect(
    connector.execute({
      sourceId: "source_jdbc",
      config,
      query: {
        ...query,
        operation: {
          method: "GET",
          path: "/rows",
          rowsPointer: "/rows",
          readOnly: true,
        },
      },
      parameters: { region: "APAC" },
    }),
  ).rejects.toThrow("Invalid JDBC query operation");
  await expect(
    connector.execute({
      sourceId: "source_jdbc",
      config,
      query,
      parameters: { region: 42 },
    }),
  ).rejects.toThrow("Invalid region");
});
