import { expect, test } from "bun:test";

const revision = {
  id: "revision_1",
  dashboardId: "dashboard_1",
  number: 1,
  digest: "a".repeat(64),
  fileCount: 2,
  totalBytes: 128,
  message: "First source Revision",
  createdAt: "2026-08-22T00:00:00.000Z",
};

const dashboard = {
  id: "dashboard_1",
  name: "Sales Overview",
  status: "active",
  version: 1,
  createdAt: "2026-08-21T00:00:00.000Z",
  updatedAt: "2026-08-21T00:00:00.000Z",
};

test("dashboard save creates and renders an immutable Revision", async () => {
  let received: Request | undefined;
  let receivedBody: unknown;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      received = request;
      receivedBody = await request.json();
      return Response.json(revision, { status: 201 });
    },
  });

  try {
    const subprocess = Bun.spawn(
      [
        process.execPath,
        new URL("./main.ts", import.meta.url).pathname,
        "--api-url",
        `http://127.0.0.1:${server.port}`,
        "dashboard",
        "save",
        "dashboard_1",
        "--message",
        "First source Revision",
      ],
      {
        env: { ...Bun.env, MDA_ACCESS_PASSWORD: "global-password" },
        stderr: "pipe",
        stdout: "pipe",
      },
    );

    expect(await subprocess.exited).toBe(0);
    expect(await new Response(subprocess.stdout).text()).toContain(
      "revision_1\tr1\t2\t128",
    );
    expect(await new Response(subprocess.stderr).text()).toBe("");
    expect(received?.url).toEndWith("/api/dashboards/dashboard_1/revisions");
    expect(received?.headers.get("idempotency-key")).toBeTruthy();
    expect(receivedBody).toEqual({ message: "First source Revision" });
  } finally {
    server.stop(true);
  }
});

test("dashboard create sends tenant auth and renders the result", async () => {
  let received: Request | undefined;
  let receivedBody: unknown;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      received = request;
      receivedBody = await request.json();
      return Response.json(dashboard, { status: 201 });
    },
  });

  try {
    const subprocess = Bun.spawn(
      [
        process.execPath,
        new URL("./main.ts", import.meta.url).pathname,
        "--api-url",
        `http://127.0.0.1:${server.port}`,
        "--tenant",
        "tenant_1",
        "dashboard",
        "create",
        "--name",
        "Sales Overview",
      ],
      {
        env: {
          ...Bun.env,
          MDA_TOKEN: "access-token",
          MDA_ACCESS_PASSWORD: "global-password",
        },
        stderr: "pipe",
        stdout: "pipe",
      },
    );

    expect(await subprocess.exited).toBe(0);
    expect(await new Response(subprocess.stdout).text()).toContain(
      "dashboard_1\tSales Overview",
    );
    expect(await new Response(subprocess.stderr).text()).toBe("");
    expect(received?.headers.get("authorization")).toBe("Bearer access-token");
    expect(received?.headers.get("x-mda-tenant")).toBe("tenant_1");
    expect(received?.headers.get("x-mda-access-password")).toBe(
      "global-password",
    );
    expect(received?.headers.get("idempotency-key")).toBeTruthy();
    expect(receivedBody).toEqual({ name: "Sales Overview" });
  } finally {
    server.stop(true);
  }
});
