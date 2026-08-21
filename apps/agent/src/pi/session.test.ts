import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentConfig } from "../config.ts";
import {
  createPiModelRuntime,
  resolveSessionPaths,
  runPiSession,
} from "./session.ts";

test("isolates Session paths and rejects traversal", () => {
  const first = resolveSessionPaths("/workspace", "dashboard_1", "session_1");
  const second = resolveSessionPaths("/workspace", "dashboard_1", "session_2");

  expect(first.workspace).toBe(
    "/workspace/dashboards/dashboard_1/sessions/session_1/workspace",
  );
  expect(second.workspace).not.toBe(first.workspace);
  expect(() =>
    resolveSessionPaths("/workspace", "dashboard_1", "../../escape"),
  ).toThrow("Invalid Agent workspace identifier");
});

test("streams a real Pi SDK session through the configured LLM API", async () => {
  let authorization: string | null = null;
  let requestPath = "";
  const requestBodies: unknown[] = [];
  const llm = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      authorization = request.headers.get("authorization");
      requestPath = new URL(request.url).pathname;
      requestBodies.push(await request.json());
      const reply =
        requestBodies.length === 1 ? "Hello from MDA" : "Still here";
      const encoder = new TextEncoder();
      return new Response(
        new ReadableStream({
          start(controller) {
            for (const chunk of [
              {
                id: "chat-1",
                object: "chat.completion.chunk",
                created: 1,
                model: "test-model",
                choices: [
                  {
                    index: 0,
                    delta: { role: "assistant" },
                    finish_reason: null,
                  },
                ],
              },
              {
                id: "chat-1",
                object: "chat.completion.chunk",
                created: 1,
                model: "test-model",
                choices: [
                  {
                    index: 0,
                    delta: { content: reply },
                    finish_reason: null,
                  },
                ],
              },
              {
                id: "chat-1",
                object: "chat.completion.chunk",
                created: 1,
                model: "test-model",
                choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
              },
            ]) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`),
              );
            }
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  const workspaceRoot = mkdtempSync(join(tmpdir(), "mda-pi-"));
  const config: AgentConfig = {
    internalAgentToken: "test-internal-agent-token-32-bytes",
    controlPlaneUrl: "http://localhost:8080",
    redisUrl: "redis://localhost:6379",
    workspaceRoot,
    skillsRoot: new URL("../../skills", import.meta.url).pathname,
    consumerId: "agent-test",
    leaseMs: 30_000,
    workers: 1,
    model: {
      provider: "mda-test",
      model: "test-model",
      baseUrl: `http://127.0.0.1:${llm.port}/v1`,
      apiKey: "test-model-key",
    },
  };
  const events: Array<{ type: string; data: Record<string, unknown> }> = [];

  try {
    await runPiSession(config, await createPiModelRuntime(config), {
      dashboardId: "dashboard_1",
      sessionId: "session_1",
      prompt: "Say hello",
      dataSources: { status: "not-configured", items: [] },
      signal: new AbortController().signal,
      onEvent: (type, data) => events.push({ type, data }),
    });

    expect(requestPath).toBe("/v1/chat/completions");
    expect(String(authorization)).toBe("Bearer test-model-key");
    expect(JSON.stringify(requestBodies[0])).toContain(
      "你是 Moss，一名专业的看板生成与编程助手",
    );
    expect(JSON.stringify(requestBodies[0])).toContain("dashboard-coding");
    expect(JSON.stringify(requestBodies[0])).toContain("尚未配置数据源服务");
    expect(JSON.stringify(requestBodies[0])).toContain(
      "read, bash, write, edit, grep, find, ls",
    );
    expect(JSON.stringify(requestBodies[0])).toContain(
      "不得创建、修改、删除、测试、启用、停用或配置数据源",
    );
    expect(
      existsSync(
        join(
          workspaceRoot,
          "dashboards/dashboard_1/sessions/session_1/workspace",
        ),
      ),
    ).toBe(true);
    expect(
      events
        .filter(({ type }) => type === "assistant.delta")
        .map(({ data }) => data.text)
        .join(""),
    ).toBe("Hello from MDA");

    const continuedEvents: typeof events = [];
    await runPiSession(config, await createPiModelRuntime(config), {
      dashboardId: "dashboard_1",
      sessionId: "session_1",
      prompt: "Are you still there?",
      dataSources: { status: "not-configured", items: [] },
      signal: new AbortController().signal,
      onEvent: (type, data) => continuedEvents.push({ type, data }),
    });
    expect(JSON.stringify(requestBodies[1])).toContain("Say hello");
    expect(JSON.stringify(requestBodies[1])).toContain("Hello from MDA");
    expect(
      continuedEvents
        .filter(({ type }) => type === "assistant.delta")
        .map(({ data }) => data.text)
        .join(""),
    ).toBe("Still here");
  } finally {
    llm.stop(true);
    rmSync(workspaceRoot, { recursive: true });
  }
});
