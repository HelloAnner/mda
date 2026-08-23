import { expect, test } from "bun:test";
import { Value } from "@sinclair/typebox/value";
import {
  AgentDataSourceContextSchema,
  AgentSessionTimelineSchema,
  ApiErrorSchema,
  CreateDashboardFolderRequestSchema,
  DashboardFolderSchema,
  ServiceMetadataSchema,
} from "./index.ts";

test("public system contracts reject unknown fields", () => {
  expect(
    Value.Check(ServiceMetadataSchema, {
      service: "mda-main",
      version: "0.1.0",
      contractVersion: "1",
    }),
  ).toBe(true);
  expect(
    Value.Check(ServiceMetadataSchema, {
      service: "mda-main",
      version: "0.1.0",
      contractVersion: "1",
      secret: "must not cross the boundary",
    }),
  ).toBe(false);
});

test("Agent Data Source summaries reject credentials", () => {
  const context = {
    status: "ready",
    items: [
      {
        id: "source_1",
        name: "销售仓库",
        kind: "jdbc",
        status: "active",
        schemaRevision: 3,
      },
    ],
  };
  expect(Value.Check(AgentDataSourceContextSchema, context)).toBe(true);
  expect(
    Value.Check(AgentDataSourceContextSchema, {
      ...context,
      items: [{ ...context.items[0], password: "must-not-cross" }],
    }),
  ).toBe(false);
});

test("Dashboard Folder and conversation read contracts stay additive", () => {
  expect(
    Value.Check(DashboardFolderSchema, {
      id: "folder_1",
      name: "经营看板",
      version: 1,
      createdAt: "2026-08-23T00:00:00.000Z",
      updatedAt: "2026-08-23T00:00:00.000Z",
    }),
  ).toBe(true);
  expect(
    Value.Check(CreateDashboardFolderRequestSchema, {
      name: "区域看板",
      parentId: "folder_1",
    }),
  ).toBe(true);
  expect(
    Value.Check(AgentSessionTimelineSchema, {
      session: {
        id: "session_1",
        dashboardId: "dashboard_1",
        status: "open",
        version: 1,
        createdAt: "2026-08-23T00:00:00.000Z",
        updatedAt: "2026-08-23T00:00:00.000Z",
      },
      turns: [],
      truncated: false,
    }),
  ).toBe(true);
});

test("API errors require safe client fields", () => {
  expect(
    Value.Check(ApiErrorSchema, {
      code: "NOT_FOUND",
      message: "Route not found",
      requestId: "request-1",
      retryable: false,
    }),
  ).toBe(true);
});
