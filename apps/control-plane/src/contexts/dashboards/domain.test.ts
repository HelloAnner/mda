import { expect, test } from "bun:test";
import { createDashboard } from "./domain.ts";

test("normalizes Dashboard names without changing their identity", () => {
  const dashboard = createDashboard(
    { name: "  Sales   Overview  ", description: "  Current sales  " },
    "tenant_1",
    "user_1",
    new Date("2026-08-21T00:00:00Z"),
  );

  expect(dashboard.name).toBe("Sales Overview");
  expect(dashboard.normalizedName).toBe("sales overview");
  expect(dashboard.description).toBe("Current sales");
  expect(dashboard.id).toStartWith("dashboard_");
});
