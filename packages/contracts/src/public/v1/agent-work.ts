import { type Static, Type } from "@sinclair/typebox";

export const AgentJobStateSchema = Type.Union([
  Type.Literal("queued"),
  Type.Literal("leased"),
  Type.Literal("running"),
  Type.Literal("succeeded"),
  Type.Literal("failed"),
  Type.Literal("cancelled"),
]);

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

export const CreateAgentJobRequestSchema = Type.Object(
  {
    message: Type.String({ minLength: 1, maxLength: 20_000, pattern: "\\S" }),
    sessionId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  },
  { $id: "CreateAgentJobRequestV1", additionalProperties: false },
);

export type AgentJob = Static<typeof AgentJobSchema>;
export type AgentJobState = Static<typeof AgentJobStateSchema>;
export type AgentSession = Static<typeof AgentSessionSchema>;
export type AgentTerminalError = Static<typeof AgentTerminalErrorSchema>;
export type CreateAgentJobRequest = Static<typeof CreateAgentJobRequestSchema>;
