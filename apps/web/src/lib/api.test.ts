import { expect, test } from "bun:test";
import { parseSseBlock } from "./api.ts";
import { assistantText, boardStage, processActivities } from "./events.ts";

const events = [
  {
    sequence: 1,
    timestamp: "2026-08-23T00:00:00.000Z",
    type: "build.started" as const,
    jobId: "job_1",
    data: {},
  },
  {
    sequence: 2,
    timestamp: "2026-08-23T00:00:01.000Z",
    type: "tool.started" as const,
    jobId: "job_1",
    data: { toolCallId: "tool_1", toolName: "build_preview" },
  },
  {
    sequence: 3,
    timestamp: "2026-08-23T00:00:03.000Z",
    type: "tool.completed" as const,
    jobId: "job_1",
    data: { toolCallId: "tool_1", toolName: "build_preview" },
  },
];

test("parses durable SSE events", () => {
  const event = parseSseBlock(
    `id: 1\nevent: build.started\ndata: ${JSON.stringify(events[0])}`,
  );
  expect(event).toEqual(events[0]);
});

test("builds compact human process activities", () => {
  const activity = processActivities(events, false);
  expect(activity[0]?.label).toContain("构建看板");
  expect(activity[0]?.tools[0]).toMatchObject({
    label: "构建看板预览",
    status: "completed",
    durationMs: 2_000,
  });
});

test("derives assistant and Board progress content", () => {
  expect(
    assistantText([
      ...events,
      {
        sequence: 4,
        timestamp: "2026-08-23T00:00:04.000Z",
        type: "assistant.delta",
        jobId: "job_1",
        data: { text: "完成" },
      },
    ]),
  ).toBe("完成");
  expect(boardStage(events[0] as (typeof events)[number])).toEqual({
    stage: "正在渲染看板",
    progress: 38,
  });
});
