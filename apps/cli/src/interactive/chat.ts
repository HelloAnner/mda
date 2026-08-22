import { createInterface } from "node:readline/promises";
import {
  type AgentEvent,
  AgentEventSchema,
  type AgentJob,
  AgentJobSchema,
} from "@mda/contracts";
import { Value } from "@sinclair/typebox/value";
import { type ApiClientConfig, apiFetch, apiRequest } from "../client/api.ts";

export async function chat(
  config: ApiClientConfig,
  dashboardId: string,
): Promise<void> {
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  let sessionId: string | undefined;
  try {
    while (true) {
      let answer: string;
      try {
        answer = await terminal.question("You › ");
      } catch (error) {
        if (
          (error as { code?: string }).code === "ERR_USE_AFTER_CLOSE" ||
          (error instanceof Error && error.message === "readline was closed")
        ) {
          break;
        }
        throw error;
      }
      const message = answer.trim();
      if (!message) continue;
      if (message === "/quit" || message === "/exit") break;

      const body = await apiRequest(
        config,
        `/api/dashboards/${encodeURIComponent(dashboardId)}/messages`,
        {
          method: "POST",
          headers: { "idempotency-key": crypto.randomUUID() },
          body: JSON.stringify({
            message,
            ...(sessionId ? { sessionId } : {}),
          }),
        },
      );
      if (!Value.Check(AgentJobSchema, body)) {
        throw new Error("Control Plane returned invalid Agent Job data");
      }
      sessionId = body.sessionId;
      await watchJob(config, body);
    }
  } finally {
    terminal.close();
  }
}

export async function watchJob(
  config: ApiClientConfig,
  initialJob: AgentJob,
  fetchEvents: typeof apiFetch = apiFetch,
  readJob: typeof apiRequest = apiRequest,
): Promise<AgentJob> {
  let cursor = 0;
  let printedAssistant = false;
  while (true) {
    let streamCompleted = false;
    try {
      const response = await fetchEvents(
        config,
        `/api/agent-jobs/${encodeURIComponent(initialJob.id)}/events?after=${cursor}`,
        { headers: cursor ? { "last-event-id": String(cursor) } : {} },
      );
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Control Plane returned no event stream");
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          const event = parseSseEvent(block);
          if (!event || event.sequence <= cursor) continue;
          cursor = event.sequence;
          if (event.type === "assistant.delta") {
            if (!printedAssistant) {
              process.stdout.write("Agent › ");
              printedAssistant = true;
            }
            process.stdout.write(String(event.data.text ?? ""));
          } else if (
            event.type === "assistant.completed" &&
            !printedAssistant
          ) {
            process.stdout.write(`Agent › ${String(event.data.text ?? "")}`);
            printedAssistant = true;
          } else if (event.type === "tool.started") {
            process.stderr.write(
              `\n  ${String(event.data.toolName ?? "tool")} …\n`,
            );
          } else if (event.type === "tool.completed") {
            process.stderr.write(
              `  ${String(event.data.toolName ?? "tool")} ${event.data.isError ? "failed" : "done"}\n`,
            );
          } else if (event.type === "build.started") {
            process.stderr.write("\n  build …\n");
          } else if (event.type === "validation.completed") {
            process.stderr.write(
              `  validation ${event.data.status === "passed" ? "passed" : "failed"}\n`,
            );
          } else if (event.type === "build.completed") {
            process.stderr.write(
              `  build ${event.data.status === "succeeded" ? "done" : "failed"}\n`,
            );
          } else if (event.type === "preview.ready") {
            process.stderr.write("  preview ready\n");
          } else if (event.type === "publication.created") {
            process.stderr.write("  publication created\n");
          } else if (event.type === "agent.failed") {
            process.stderr.write(
              `\nAgent failed: ${String(event.data.message ?? "Unknown error")}\n`,
            );
          }
        }
        if (done) {
          streamCompleted = true;
          break;
        }
      }
    } catch {
      // Durable events resume from cursor on the next loop.
    }

    const job = await readJob(
      config,
      `/api/agent-jobs/${encodeURIComponent(initialJob.id)}`,
    );
    if (!Value.Check(AgentJobSchema, job)) {
      throw new Error("Control Plane returned invalid Agent Job data");
    }
    if (
      streamCompleted &&
      ["succeeded", "failed", "cancelled"].includes(job.state)
    ) {
      if (printedAssistant) process.stdout.write("\n");
      if (job.terminalError) {
        process.stderr.write(
          `${job.terminalError.code}: ${job.terminalError.message}\n`,
        );
      }
      return job;
    }
    await Bun.sleep(250);
  }
}

export function parseSseEvent(block: string): AgentEvent | undefined {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart())
    .join("\n");
  if (!data) return undefined;
  const value: unknown = JSON.parse(data);
  return Value.Check(AgentEventSchema, value) ? value : undefined;
}
