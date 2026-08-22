import { afterAll, expect, test } from "bun:test";
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

test("blocks private destinations unless explicitly approved", async () => {
  await expect(
    validateDestination({ ...config, allowPrivateNetwork: false }),
  ).rejects.toThrow("HTTPS is required");
  await expect(executeHttpQuery(config, query, {})).rejects.toThrow(
    "Missing region",
  );
});
