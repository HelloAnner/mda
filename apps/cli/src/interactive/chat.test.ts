import { expect, test } from "bun:test";
import type { AgentJob } from "@mda/contracts";
import type { ApiClientConfig } from "../client/api.ts";
import { parseSseEvent, watchJob } from "./chat.ts";

test("parses durable Agent SSE events", () => {
  expect(
    parseSseEvent(
      'id: 1\nevent: assistant.delta\ndata: {"sequence":1,"timestamp":"2026-08-21T00:00:00Z","type":"assistant.delta","jobId":"job_1","data":{"text":"hello"}}',
    ),
  ).toMatchObject({
    sequence: 1,
    type: "assistant.delta",
    data: { text: "hello" },
  });
});

test("resumes durable events after an SSE socket failure", async () => {
  const eventQueries: string[] = [];
  let jobReads = 0;
  const event = (sequence: number, text: string) =>
    `id: ${sequence}\nevent: assistant.delta\ndata: ${JSON.stringify({
      sequence,
      timestamp: "2026-08-21T00:00:00Z",
      type: "assistant.delta",
      jobId: "job_1",
      data: { text },
    })}\n\n`;
  const job: AgentJob = {
    id: "job_1",
    dashboardId: "dashboard_1",
    sessionId: "session_1",
    purpose: "edit",
    state: "queued",
    attemptCount: 0,
    version: 1,
    createdAt: "2026-08-21T00:00:00Z",
  };
  const fetchEvents = async (
    _config: ApiClientConfig,
    path: string,
    init: RequestInit = {},
  ) => {
    const url = new URL(path, "http://test");
    const headers = new Headers(init.headers);
    eventQueries.push(
      `${url.searchParams.get("after")}:${headers.get("last-event-id")}`,
    );
    if (eventQueries.length === 1) {
      let sent = false;
      return new Response(
        new ReadableStream({
          pull(controller) {
            if (!sent) {
              sent = true;
              controller.enqueue(new TextEncoder().encode(event(1, "hello")));
            } else {
              controller.error(new Error("socket lost"));
            }
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    }
    return new Response(event(2, " world"), {
      headers: { "content-type": "text/event-stream" },
    });
  };
  const readJob = async () => {
    jobReads += 1;
    return { ...job, state: jobReads === 1 ? "running" : "succeeded" };
  };
  const originalWrite = process.stdout.write;
  let output = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += String(chunk);
    return true;
  }) as typeof process.stdout.write;

  try {
    await watchJob(
      { apiUrl: "http://test", version: "0.1.0" },
      job,
      fetchEvents,
      readJob,
    );
    expect(eventQueries).toEqual(["0:null", "1:1"]);
    expect(output).toBe("Agent › hello world\n");
  } finally {
    process.stdout.write = originalWrite;
  }
});
