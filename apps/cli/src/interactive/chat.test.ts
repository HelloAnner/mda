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

test("retries a transient Job read after the event stream completes", async () => {
  const job: AgentJob = {
    id: "job_retry",
    dashboardId: "dashboard_1",
    sessionId: "session_1",
    purpose: "edit",
    state: "running",
    attemptCount: 1,
    version: 2,
    createdAt: "2026-08-21T00:00:00Z",
    startedAt: "2026-08-21T00:00:01Z",
  };
  const event = `id: 1\nevent: assistant.completed\ndata: ${JSON.stringify({
    sequence: 1,
    timestamp: "2026-08-21T00:00:02Z",
    type: "assistant.completed",
    jobId: job.id,
    data: { text: "done" },
  })}\n\n`;
  let reads = 0;
  let streams = 0;
  const originalWrite = process.stdout.write;
  let output = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += String(chunk);
    return true;
  }) as typeof process.stdout.write;

  try {
    const result = await watchJob(
      { apiUrl: "http://test", version: "0.1.0" },
      job,
      async () => {
        streams += 1;
        return new Response(event, {
          headers: { "content-type": "text/event-stream" },
        });
      },
      async () => {
        reads += 1;
        if (reads === 1) throw new Error("socket closed");
        return {
          ...job,
          state: "succeeded",
          version: 3,
          finishedAt: "2026-08-21T00:00:03Z",
        };
      },
    );
    expect(result.state).toBe("succeeded");
    expect({ reads, streams, output }).toEqual({
      reads: 2,
      streams: 2,
      output: "Agent › done\n",
    });
  } finally {
    process.stdout.write = originalWrite;
  }
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
