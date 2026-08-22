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

test("dashboard preview waits for the isolated build and prints its URL", async () => {
  const job = {
    id: "job_preview_1",
    dashboardId: "dashboard_1",
    sessionId: "session_preview_1",
    purpose: "preview",
    state: "queued",
    attemptCount: 0,
    version: 1,
    createdAt: "2026-08-22T00:00:00.000Z",
  };
  const preview = {
    id: "preview_1",
    dashboardId: "dashboard_1",
    jobId: job.id,
    sourceCheckpointId: "checkpoint_1",
    sourceRevisionId: "revision_1",
    sourceDigest: "a".repeat(64),
    status: "ready",
    templateVersion: "1",
    runtimeVersion: "1",
    manifestDigest: "b".repeat(64),
    buildDigest: "c".repeat(64),
    fileCount: 2,
    totalBytes: 256,
    url: "https://preview.example/p/preview_1/token/",
    expiresAt: "2026-08-22T01:00:00.000Z",
    createdAt: "2026-08-22T00:00:00.000Z",
    completedAt: "2026-08-22T00:00:01.000Z",
  };
  let requestBody: unknown;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (request.method === "POST") {
        requestBody = await request.json();
        return Response.json(
          {
            preview: {
              ...preview,
              status: "building",
              manifestDigest: undefined,
              buildDigest: undefined,
              fileCount: undefined,
              totalBytes: undefined,
              completedAt: undefined,
            },
            job,
          },
          { status: 202 },
        );
      }
      if (path.endsWith("/events")) {
        const event = {
          sequence: 1,
          timestamp: "2026-08-22T00:00:01.000Z",
          type: "preview.ready",
          jobId: job.id,
          data: { previewId: preview.id },
        };
        return new Response(
          `id: 1\nevent: preview.ready\ndata: ${JSON.stringify(event)}\n\n`,
          {
            headers: { "content-type": "text/event-stream" },
          },
        );
      }
      if (path === `/api/agent-jobs/${job.id}`) {
        return Response.json({
          ...job,
          state: "succeeded",
          version: 3,
          startedAt: "2026-08-22T00:00:00.100Z",
          finishedAt: "2026-08-22T00:00:01.000Z",
        });
      }
      return Response.json(preview);
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
        "preview",
        "dashboard_1",
        "--revision",
        "revision_1",
      ],
      { stderr: "pipe", stdout: "pipe" },
    );
    expect(await subprocess.exited).toBe(0);
    expect((await new Response(subprocess.stdout).text()).trim()).toBe(
      preview.url,
    );
    expect(await new Response(subprocess.stderr).text()).toContain(
      "preview ready",
    );
    expect(requestBody).toEqual({ revisionId: "revision_1" });
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
