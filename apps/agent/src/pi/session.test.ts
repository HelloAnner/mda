import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentConfig } from "../config.ts";
import { createPiModelRuntime, runPiSession } from "./session.ts";

test("streams a real Pi SDK session through the configured LLM API", async () => {
  let authorization: string | null = null;
  let requestPath = "";
  const llm = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      authorization = request.headers.get("authorization");
      requestPath = new URL(request.url).pathname;
      await request.json();
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
                    delta: { content: "Hello from MDA" },
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
      signal: new AbortController().signal,
      onEvent: (type, data) => events.push({ type, data }),
    });

    expect(requestPath).toBe("/v1/chat/completions");
    expect(String(authorization)).toBe("Bearer test-model-key");
    expect(
      events
        .filter(({ type }) => type === "assistant.delta")
        .map(({ data }) => data.text)
        .join(""),
    ).toBe("Hello from MDA");
  } finally {
    llm.stop(true);
    rmSync(workspaceRoot, { recursive: true });
  }
});
