import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("serves the built web shell with restrictive browser headers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mda-web-"));
  await Bun.write(
    join(directory, "index.html"),
    "<!doctype html><title>MDA Web</title>",
  );
  const web = startServer(0, "127.0.0.1", {
    db: {} as SQL,
    authenticate: async () => ({
      tenantId: "tenant_1",
      userId: "user_1",
      permissions: [],
    }),
    webRoot: directory,
  });
  try {
    const response = await fetch(`http://127.0.0.1:${web.port}/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("MDA Web");
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  } finally {
    web.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
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
