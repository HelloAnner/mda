import { expect, test } from "bun:test";
import { parseSseEvent } from "./chat.ts";

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
