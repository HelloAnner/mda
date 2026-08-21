import { expect, test } from "bun:test";
import type { AgentJobAggregate } from "./domain.ts";
import {
  claimJob,
  recoverExpiredJob,
  renewJobLease,
  requestJobCancellation,
  settleJob,
  startJob,
} from "./domain.ts";

const queued: AgentJobAggregate = {
  id: "job_1",
  state: "queued",
  attemptCount: 0,
  fencingToken: 0,
  version: 1,
  createdAt: "2026-08-21T00:00:00.000Z",
};

test("leases, starts, renews, and settles with one fencing token", () => {
  const claimed = claimJob(
    queued,
    "agent_1",
    new Date("2026-08-21T00:00:00Z"),
    30_000,
  );
  const running = startJob(
    claimed,
    "agent_1",
    claimed.fencingToken,
    new Date("2026-08-21T00:00:01Z"),
  );
  const renewed = renewJobLease(
    running,
    "agent_1",
    claimed.fencingToken,
    new Date("2026-08-21T00:00:10Z"),
    30_000,
  );
  const settled = settleJob(
    renewed,
    { owner: "agent_1", fencingToken: 1, state: "succeeded" },
    new Date("2026-08-21T00:00:20Z"),
  );

  expect(settled.state).toBe("succeeded");
  expect(settled.attemptCount).toBe(1);
  expect(settled.leaseOwner).toBeUndefined();
  expect(() =>
    startJob(claimed, "agent_1", 2, new Date("2026-08-21T00:00:01Z")),
  ).toThrow("stale");
});

test("cancellation survives lease expiry and prevents stale success", () => {
  const claimed = claimJob(
    queued,
    "agent_1",
    new Date("2026-08-21T00:00:00Z"),
    1_000,
  );
  const running = startJob(
    claimed,
    "agent_1",
    1,
    new Date("2026-08-21T00:00:00.500Z"),
  );
  const cancelling = requestJobCancellation(
    running,
    new Date("2026-08-21T00:00:00.600Z"),
  );

  expect(() =>
    settleJob(
      cancelling,
      { owner: "agent_1", fencingToken: 1, state: "succeeded" },
      new Date("2026-08-21T00:00:00.700Z"),
    ),
  ).toThrow("cancellation");
  expect(
    recoverExpiredJob(cancelling, new Date("2026-08-21T00:00:02Z")).state,
  ).toBe("cancelled");
});
