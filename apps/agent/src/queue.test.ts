import { expect, test } from "bun:test";
import { parseAgentJobResponse, parseAutoClaimResponse } from "./queue.ts";

test("parses Bun's Redis Stream response", () => {
  expect(
    parseAgentJobResponse({
      "mda:agent-jobs": [["1-0", ["jobId", "job_1", "tenantId", "tenant_1"]]],
    }),
  ).toEqual({ id: "1-0", jobId: "job_1" });
});

test("parses reclaimed Redis pending entries", () => {
  expect(
    parseAutoClaimResponse([
      "0-0",
      [["2-0", ["jobId", "job_2", "tenantId", "tenant_1"]]],
      [],
    ]),
  ).toEqual({ id: "2-0", jobId: "job_2" });
});
