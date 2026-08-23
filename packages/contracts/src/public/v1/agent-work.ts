import { type Static, Type } from "@sinclair/typebox";

export const AgentJobPurposeSchema = Type.Union([
  Type.Literal("edit"),
  Type.Literal("preview"),
  Type.Literal("publish"),
]);

export const AgentJobStateSchema = Type.Union([
  Type.Literal("queued"),
  Type.Literal("leased"),
  Type.Literal("running"),
  Type.Literal("succeeded"),
  Type.Literal("failed"),
  Type.Literal("cancelled"),
]);

export const AgentEventTypeSchema = Type.Union([
  Type.Literal("agent.started"),
  Type.Literal("agent.progress"),
  Type.Literal("assistant.delta"),
  Type.Literal("assistant.completed"),
  Type.Literal("tool.started"),
  Type.Literal("tool.completed"),
  Type.Literal("draft.checkpoint.saved"),
  Type.Literal("build.started"),
  Type.Literal("validation.completed"),
  Type.Literal("build.completed"),
  Type.Literal("preview.ready"),
  Type.Literal("publication.created"),
  Type.Literal("agent.failed"),
  Type.Literal("agent.completed"),
]);

export const AgentEventSchema = Type.Object(
  {
    sequence: Type.Integer({ minimum: 1 }),
    timestamp: Type.String({ minLength: 1 }),
    type: AgentEventTypeSchema,
    jobId: Type.String({ minLength: 1 }),
    data: Type.Record(Type.String(), Type.Unknown()),
  },
  { $id: "AgentEventV1", additionalProperties: false },
);

export const AgentTerminalErrorSchema = Type.Object(
  {
    code: Type.String({ minLength: 1, maxLength: 100 }),
    message: Type.String({ minLength: 1, maxLength: 2000 }),
    retryable: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const AgentSessionSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    dashboardId: Type.String({ minLength: 1 }),
    status: Type.Union([Type.Literal("open"), Type.Literal("closed")]),
    version: Type.Integer({ minimum: 1 }),
    createdAt: Type.String({ minLength: 1 }),
    updatedAt: Type.String({ minLength: 1 }),
  },
  { $id: "AgentSessionV1", additionalProperties: false },
);

export const AgentJobSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    dashboardId: Type.String({ minLength: 1 }),
    sessionId: Type.String({ minLength: 1 }),
    purpose: AgentJobPurposeSchema,
    state: AgentJobStateSchema,
    attemptCount: Type.Integer({ minimum: 0 }),
    cancellationRequestedAt: Type.Optional(Type.String({ minLength: 1 })),
    terminalError: Type.Optional(AgentTerminalErrorSchema),
    version: Type.Integer({ minimum: 1 }),
    createdAt: Type.String({ minLength: 1 }),
    startedAt: Type.Optional(Type.String({ minLength: 1 })),
    finishedAt: Type.Optional(Type.String({ minLength: 1 })),
  },
  { $id: "AgentJobV1", additionalProperties: false },
);

export const AgentJobListResponseSchema = Type.Object(
  { items: Type.Array(AgentJobSchema, { maxItems: 100 }) },
  { additionalProperties: false },
);

export const CreateAgentJobRequestSchema = Type.Object(
  {
    message: Type.String({ minLength: 1, maxLength: 20_000, pattern: "\\S" }),
    sessionId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  },
  { $id: "CreateAgentJobRequestV1", additionalProperties: false },
);

export type AgentEvent = Static<typeof AgentEventSchema>;
export type AgentEventType = Static<typeof AgentEventTypeSchema>;
export type AgentJob = Static<typeof AgentJobSchema>;
export type AgentJobListResponse = Static<typeof AgentJobListResponseSchema>;
export type AgentJobPurpose = Static<typeof AgentJobPurposeSchema>;
export type AgentJobState = Static<typeof AgentJobStateSchema>;
export type AgentSession = Static<typeof AgentSessionSchema>;
export type AgentTerminalError = Static<typeof AgentTerminalErrorSchema>;
export type CreateAgentJobRequest = Static<typeof CreateAgentJobRequestSchema>;
