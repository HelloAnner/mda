import { afterAll, beforeAll, expect, test } from "bun:test";
import type { Server } from "bun";
import { SQL } from "bun";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { migrate } from "../../migrate.ts";
import { startServer } from "../../server.ts";
import { createAuthenticator } from "../../shared/auth.ts";

const databaseUrl = Bun.env.TEST_DATABASE_URL;
const integrationTest = databaseUrl ? test : test.skip;
let db: SQL;
let server: Server<unknown>;
let baseUrl: string;
let token: string;

function authorizedHeaders(extra: Record<string, string> = {}): HeadersInit {
  return {
    authorization: `Bearer ${token}`,
    "x-mda-tenant": "tenant_1",
    ...extra,
  };
}

beforeAll(async () => {
  if (!databaseUrl) return;
  await migrate(databaseUrl);
  db = new SQL(databaseUrl);
  await db`
    INSERT INTO tenants (id, display_name)
    VALUES ('tenant_1', 'Test Tenant'), ('tenant_2', 'Other Tenant')
  `;
  await db`
    INSERT INTO users (id, oidc_issuer, oidc_subject, display_name)
    VALUES ('user_1', 'https://identity.example', 'subject_1', 'Test User')
  `;
  await db`
    INSERT INTO memberships (tenant_id, user_id, permissions)
    VALUES ('tenant_1', 'user_1', ARRAY['dashboard.create', 'dashboard.read'])
  `;
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const key = { ...(await exportJWK(publicKey)), kid: "test", alg: "ES256" };
  token = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: "test" })
    .setIssuer("https://identity.example")
    .setAudience("mda")
    .setSubject("subject_1")
    .setExpirationTime("5m")
    .sign(privateKey);
  const oidc = {
    oidcIssuer: "https://identity.example",
    oidcAudience: "mda",
    oidcJwksUrl: "https://identity.example/jwks.json",
  };
  server = startServer(0, "127.0.0.1", {
    db,
    authenticate: createAuthenticator(
      oidc,
      db,
      createLocalJWKSet({ keys: [key] }),
    ),
  });
  baseUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  if (!databaseUrl) return;
  server?.stop(true);
  await db?.close();
});

integrationTest(
  "creates, replays, lists, and reads a tenant Dashboard",
  async () => {
    const create = () =>
      fetch(`${baseUrl}/api/dashboards`, {
        method: "POST",
        headers: authorizedHeaders({
          "content-type": "application/json",
          "idempotency-key": "create-sales",
        }),
        body: JSON.stringify({ name: "Sales Overview" }),
      });

    const first = await create();
    expect(first.status).toBe(201);
    const dashboard = await first.json();

    const replay = await create();
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(dashboard);

    const list = await fetch(`${baseUrl}/api/dashboards`, {
      headers: authorizedHeaders(),
    });
    expect((await list.json()).items).toEqual([dashboard]);

    const show = await fetch(`${baseUrl}/api/dashboards/${dashboard.id}`, {
      headers: authorizedHeaders(),
    });
    expect(await show.json()).toEqual(dashboard);

    const crossTenant = await fetch(
      `${baseUrl}/api/dashboards/${dashboard.id}`,
      { headers: authorizedHeaders({ "x-mda-tenant": "tenant_2" }) },
    );
    expect(crossTenant.status).toBe(403);

    const [{ outbox_count, audit_count }] = await db`
    SELECT
      (SELECT count(*)::int FROM control_outbox) AS outbox_count,
      (SELECT count(*)::int FROM audit_events) AS audit_count
  `;
    expect({ outbox_count, audit_count }).toEqual({
      outbox_count: 1,
      audit_count: 1,
    });

    const duplicate = await fetch(`${baseUrl}/api/dashboards`, {
      method: "POST",
      headers: authorizedHeaders({
        "content-type": "application/json",
        "idempotency-key": "duplicate-sales",
      }),
      body: JSON.stringify({ name: "  SALES OVERVIEW " }),
    });
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).code).toBe("DASHBOARD_NAME_CONFLICT");
  },
);
