import { type Static, Type } from "@sinclair/typebox";
import {
  AgentJobSchema,
  AgentTerminalErrorSchema,
} from "../../../public/v1/agent-work.ts";
import { AgentWorkspaceRestoreSchema } from "./workspace.ts";

export const ClaimAgentJobRequestSchema = Type.Object(
  { owner: Type.String({ minLength: 1, maxLength: 200 }) },
  { additionalProperties: false },
);

export const AgentLeaseCommandSchema = Type.Object(
  {
    owner: Type.String({ minLength: 1, maxLength: 200 }),
    fencingToken: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

export const SettleAgentJobRequestSchema = Type.Object(
  {
    owner: Type.String({ minLength: 1, maxLength: 200 }),
    fencingToken: Type.Integer({ minimum: 1 }),
    state: Type.Union([
      Type.Literal("succeeded"),
      Type.Literal("failed"),
      Type.Literal("cancelled"),
    ]),
    error: Type.Optional(AgentTerminalErrorSchema),
  },
  { additionalProperties: false },
);

export const AgentDataSourceSummarySchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1, maxLength: 200 }),
    description: Type.Optional(Type.String({ maxLength: 2_000 })),
    kind: Type.Union([Type.Literal("http"), Type.Literal("jdbc")]),
    status: Type.Union([
      Type.Literal("active"),
      Type.Literal("disabled"),
      Type.Literal("degraded"),
    ]),
    schemaRevision: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

export const AgentDataSourceContextSchema = Type.Object(
  {
    status: Type.Union([
      Type.Literal("ready"),
      Type.Literal("not-configured"),
      Type.Literal("unavailable"),
    ]),
    items: Type.Array(AgentDataSourceSummarySchema),
  },
  { additionalProperties: false },
);

export const ClaimedAgentJobSchema = Type.Object(
  {
    job: AgentJobSchema,
    prompt: Type.String({ minLength: 1, maxLength: 20_000 }),
    dataSources: AgentDataSourceContextSchema,
    workspace: Type.Optional(AgentWorkspaceRestoreSchema),
    preview: Type.Optional(
      Type.Object(
        {
          id: Type.String({ minLength: 1 }),
          sourceDigest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
        },
        { additionalProperties: false },
      ),
    ),
    lease: Type.Object(
      {
        owner: Type.String({ minLength: 1 }),
        fencingToken: Type.Integer({ minimum: 1 }),
        expiresAt: Type.String({ minLength: 1 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export type AgentDataSourceContext = Static<
  typeof AgentDataSourceContextSchema
>;
export type AgentDataSourceSummary = Static<
  typeof AgentDataSourceSummarySchema
>;
export type AgentLeaseCommand = Static<typeof AgentLeaseCommandSchema>;
export type ClaimAgentJobRequest = Static<typeof ClaimAgentJobRequestSchema>;
export type ClaimedAgentJob = Static<typeof ClaimedAgentJobSchema>;
export type SettleAgentJobRequest = Static<typeof SettleAgentJobRequestSchema>;
