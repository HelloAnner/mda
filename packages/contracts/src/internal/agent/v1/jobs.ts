import { type Static, Type } from "@sinclair/typebox";
import {
  AgentJobSchema,
  AgentTerminalErrorSchema,
} from "../../../public/v1/agent-work.ts";

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

export const ClaimedAgentJobSchema = Type.Object(
  {
    job: AgentJobSchema,
    prompt: Type.String({ minLength: 1, maxLength: 20_000 }),
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

export type AgentLeaseCommand = Static<typeof AgentLeaseCommandSchema>;
export type ClaimAgentJobRequest = Static<typeof ClaimAgentJobRequestSchema>;
export type ClaimedAgentJob = Static<typeof ClaimedAgentJobSchema>;
export type SettleAgentJobRequest = Static<typeof SettleAgentJobRequestSchema>;
