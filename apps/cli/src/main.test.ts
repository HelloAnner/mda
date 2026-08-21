import { expect, test } from "bun:test";

const dashboard = {
  id: "dashboard_1",
  name: "Sales Overview",
  status: "active",
  version: 1,
  createdAt: "2026-08-21T00:00:00.000Z",
  updatedAt: "2026-08-21T00:00:00.000Z",
};

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
