import { afterAll, beforeAll, expect, test } from "bun:test";
import type { Server } from "bun";
import { SQL } from "bun";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { snapshotDigest } from "./contexts/revisions/snapshot.ts";
import { migrate } from "./migrate.ts";
import { startServer } from "./server.ts";
import { MemoryArtifactStore } from "./shared/artifacts.ts";
import { createAuthenticator } from "./shared/auth.ts";

const databaseUrl = Bun.env.TEST_DATABASE_URL;
const integrationTest = databaseUrl ? test : test.skip;
let db: SQL;
let server: Server<unknown>;
let baseUrl: string;
let token: string;
const artifacts = new MemoryArtifactStore();

function authorizedHeaders(extra: Record<string, string> = {}): HeadersInit {
  return {
    authorization: `Bearer ${token}`,
    "x-mda-tenant": "tenant_1",
    ...extra,
  };
}

function sourceSnapshot() {
  const bytes = new TextEncoder().encode("export const dashboard = true;\n");
  const files = [{ path: "src/app.ts", bytes, executable: false }];
  const computed = snapshotDigest(files);
  return {
    schemaVersion: 1 as const,
    digest: computed.digest,
    fileCount: files.length,
    totalBytes: computed.totalBytes,
    files: [
      {
        path: "src/app.ts",
        content: Buffer.from(bytes).toString("base64"),
        executable: false,
      },
    ],
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
    VALUES (
      'tenant_1', 'user_1',
      ARRAY['dashboard.create', 'dashboard.read', 'dashboard.edit']
    )
  `;
  await db`
    INSERT INTO dashboards (
      id, tenant_id, name, normalized_name, status,
      version, created_by, created_at, updated_at
    ) VALUES (
      'dashboard_agent', 'tenant_1', 'Agent Test', 'agent test', 'active',
      1, 'user_1', now(), now()
    )
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
    internalAgentToken: "test-internal-agent-token-32-bytes",
    agentLeaseMs: 30_000,
    artifacts,
    previewSigningKey: "test-preview-signing-key-at-least-32-bytes",
    previewTtlSeconds: 3_600,
  });
  baseUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  if (!databaseUrl) return;
  server?.stop(true);
  await db?.close();
});

integrationTest("enqueues and fences authoritative Agent work", async () => {
  const enqueue = () =>
    fetch(`${baseUrl}/api/dashboards/dashboard_agent/messages`, {
      method: "POST",
      headers: authorizedHeaders({
        "content-type": "application/json",
        "idempotency-key": "agent-edit-1",
      }),
      body: JSON.stringify({ message: "Build a sales dashboard" }),
    });
  const first = await enqueue();
  expect(first.status).toBe(202);
  const queued = await first.json();
  expect(queued).toMatchObject({ state: "queued", purpose: "edit" });
  expect(queued.prompt).toBeUndefined();

  const replay = await enqueue();
  expect(replay.status).toBe(200);
  expect(await replay.json()).toEqual(queued);

  const internalHeaders = {
    authorization: "Bearer test-internal-agent-token-32-bytes",
    "content-type": "application/json",
  };
  const claim = await fetch(
    `${baseUrl}/internal/v1/agent-jobs/${queued.id}/claim`,
    {
      method: "POST",
      headers: internalHeaders,
      body: JSON.stringify({ owner: "agent_1" }),
    },
  );
  expect(claim.status).toBe(200);
  const claimed = await claim.json();
  expect(claimed.prompt).toBe("Build a sales dashboard");
  expect(claimed.dataSources).toEqual({ status: "not-configured", items: [] });
  expect(claimed.lease.fencingToken).toBe(1);

  const staleStart = await fetch(
    `${baseUrl}/internal/v1/agent-jobs/${queued.id}/start`,
    {
      method: "POST",
      headers: internalHeaders,
      body: JSON.stringify({ owner: "agent_1", fencingToken: 2 }),
    },
  );
  expect(staleStart.status).toBe(409);
  expect((await staleStart.json()).code).toBe("STALE_LEASE");

  const command = JSON.stringify({ owner: "agent_1", fencingToken: 1 });
  const started = await fetch(
    `${baseUrl}/internal/v1/agent-jobs/${queued.id}/start`,
    { method: "POST", headers: internalHeaders, body: command },
  );
  expect((await started.json()).state).toBe("running");
  const heartbeat = await fetch(
    `${baseUrl}/internal/v1/agent-jobs/${queued.id}/heartbeat`,
    { method: "POST", headers: internalHeaders, body: command },
  );
  expect((await heartbeat.json()).state).toBe("running");
  const appended = await fetch(
    `${baseUrl}/internal/v1/agent-jobs/${queued.id}/events`,
    {
      method: "POST",
      headers: internalHeaders,
      body: JSON.stringify({
        owner: "agent_1",
        fencingToken: 1,
        events: [{ type: "assistant.delta", data: { text: "hello" } }],
      }),
    },
  );
  expect((await appended.json())[0].sequence).toBe(1);
  const snapshot = sourceSnapshot();
  const checkpoint = await fetch(
    `${baseUrl}/internal/v1/agent-jobs/${queued.id}/checkpoint`,
    {
      method: "POST",
      headers: internalHeaders,
      body: JSON.stringify({
        owner: "agent_1",
        fencingToken: 1,
        snapshot,
      }),
    },
  );
  expect(checkpoint.status).toBe(200);
  expect(await checkpoint.json()).toMatchObject({
    created: true,
    digest: snapshot.digest,
  });
  const settled = await fetch(
    `${baseUrl}/internal/v1/agent-jobs/${queued.id}/settle`,
    {
      method: "POST",
      headers: internalHeaders,
      body: JSON.stringify({
        owner: "agent_1",
        fencingToken: 1,
        state: "succeeded",
      }),
    },
  );
  expect((await settled.json()).state).toBe("succeeded");

  const save = await fetch(
    `${baseUrl}/api/dashboards/dashboard_agent/revisions`,
    {
      method: "POST",
      headers: authorizedHeaders({
        "content-type": "application/json",
        "idempotency-key": "save-agent-source-1",
      }),
      body: JSON.stringify({ message: "First source Revision" }),
    },
  );
  expect(save.status).toBe(201);
  const revision = await save.json();
  expect(revision).toMatchObject({
    dashboardId: "dashboard_agent",
    number: 1,
    digest: snapshot.digest,
    fileCount: 1,
    message: "First source Revision",
  });
  expect(revision.artifactKey).toBeUndefined();

  const files = await fetch(`${baseUrl}/api/revisions/${revision.id}/files`, {
    headers: authorizedHeaders(),
  });
  expect(await files.json()).toEqual({
    items: [
      {
        path: "src/app.ts",
        size: 31,
        digest: expect.any(String),
        executable: false,
      },
    ],
  });
  const source = await fetch(
    `${baseUrl}/api/revisions/${revision.id}/files/${encodeURIComponent("src/app.ts")}`,
    { headers: authorizedHeaders() },
  );
  expect(await source.text()).toBe("export const dashboard = true;\n");
  const exported = await fetch(
    `${baseUrl}/api/revisions/${revision.id}/export`,
    { headers: authorizedHeaders() },
  );
  expect(exported.headers.get("content-type")).toBe("application/gzip");
  expect(
    Buffer.from(
      Bun.gunzipSync(new Uint8Array(await exported.arrayBuffer())).subarray(
        512,
        543,
      ),
    ).toString(),
  ).toBe("export const dashboard = true;\n");

  const restoreJobResponse = await fetch(
    `${baseUrl}/api/dashboards/dashboard_agent/messages`,
    {
      method: "POST",
      headers: authorizedHeaders({
        "content-type": "application/json",
        "idempotency-key": "agent-edit-restore-1",
      }),
      body: JSON.stringify({ message: "Continue the Dashboard" }),
    },
  );
  const restoreJob = await restoreJobResponse.json();
  const restoreClaim = await fetch(
    `${baseUrl}/internal/v1/agent-jobs/${restoreJob.id}/claim`,
    {
      method: "POST",
      headers: internalHeaders,
      body: JSON.stringify({ owner: "agent_2" }),
    },
  );
  const restored = await restoreClaim.json();
  expect(restored.workspace.snapshot).toEqual(snapshot);
  expect(restored.workspace.checkpointId).toStartWith("checkpoint_");
  const restoreLease = JSON.stringify({
    owner: "agent_2",
    fencingToken: restored.lease.fencingToken,
  });
  await fetch(`${baseUrl}/internal/v1/agent-jobs/${restoreJob.id}/start`, {
    method: "POST",
    headers: internalHeaders,
    body: restoreLease,
  });
  await fetch(`${baseUrl}/internal/v1/agent-jobs/${restoreJob.id}/settle`, {
    method: "POST",
    headers: internalHeaders,
    body: JSON.stringify({
      owner: "agent_2",
      fencingToken: restored.lease.fencingToken,
      state: "succeeded",
    }),
  });

  const visible = await fetch(`${baseUrl}/api/agent-jobs/${queued.id}`, {
    headers: authorizedHeaders(),
  });
  expect((await visible.json()).state).toBe("succeeded");

  const stream = await fetch(`${baseUrl}/api/agent-jobs/${queued.id}/events`, {
    headers: authorizedHeaders(),
  });
  expect(await stream.text()).toContain('"text":"hello"');

  const [{ count }] = await db`
    SELECT count(*)::int AS count
    FROM control_outbox
    WHERE event_type = 'agent.job-queued' AND aggregate_id = ${queued.id}
  `;
  expect(count).toBe(1);
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
    const items = (await list.json()).items;
    expect(
      items.find((item: { id: string }) => item.id === dashboard.id),
    ).toEqual(dashboard);

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
        (
          SELECT count(*)::int FROM control_outbox
          WHERE aggregate_id = ${dashboard.id}
        ) AS outbox_count,
        (
          SELECT count(*)::int FROM audit_events
          WHERE aggregate_id = ${dashboard.id}
        ) AS audit_count
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
