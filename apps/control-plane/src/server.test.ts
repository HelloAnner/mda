import { afterAll, beforeAll, expect, test } from "bun:test";
import { ApiErrorSchema, ServiceMetadataSchema } from "@mda/contracts";
import { Value } from "@sinclair/typebox/value";
import type { Server, SQL } from "bun";
import { startServer } from "./server.ts";

let server: Server<unknown>;
let baseUrl: string;

beforeAll(() => {
  server = startServer(0, "127.0.0.1");
  baseUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(() => server.stop(true));

test("serves versioned service metadata", async () => {
  const response = await fetch(`${baseUrl}/api/meta`);
  expect(response.status).toBe(200);
  expect(Value.Check(ServiceMetadataSchema, await response.json())).toBe(true);
});

test("returns the shared error contract for unknown routes", async () => {
  const response = await fetch(`${baseUrl}/missing`);
  expect(response.status).toBe(404);
  expect(Value.Check(ApiErrorSchema, await response.json())).toBe(true);
});

test("gates public APIs with the deployment access password", async () => {
  const gated = startServer(0, "127.0.0.1", {
    db: {} as SQL,
    authenticate: async () => ({
      tenantId: "tenant_1",
      userId: "user_1",
      permissions: [],
    }),
    accessPassword: "global-password",
  });
  try {
    const url = `http://127.0.0.1:${gated.port}/api/unknown`;
    expect((await fetch(url)).status).toBe(401);
    expect(
      (
        await fetch(url, {
          headers: { "x-mda-access-password": "global-password" },
        })
      ).status,
    ).toBe(404);
  } finally {
    gated.stop(true);
  }
});
