import { expect, test } from "bun:test";
import { parseAgentJobResponse } from "./queue.ts";

test("parses Bun's Redis Stream response", () => {
  expect(
    parseAgentJobResponse({
      "mda:agent-jobs": [["1-0", ["jobId", "job_1", "tenantId", "tenant_1"]]],
    }),
  ).toEqual({ id: "1-0", jobId: "job_1" });
});
