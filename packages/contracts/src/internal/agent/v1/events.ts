import { type Static, Type } from "@sinclair/typebox";
import { AgentEventTypeSchema } from "../../../public/v1/agent-work.ts";

export const PendingAgentEventSchema = Type.Object(
  {
    type: AgentEventTypeSchema,
    data: Type.Record(Type.String(), Type.Unknown()),
  },
  { additionalProperties: false },
);

export const AppendAgentEventsRequestSchema = Type.Object(
  {
    owner: Type.String({ minLength: 1, maxLength: 200 }),
    fencingToken: Type.Integer({ minimum: 1 }),
    events: Type.Array(PendingAgentEventSchema, { minItems: 1, maxItems: 100 }),
  },
  { additionalProperties: false },
);

export type AppendAgentEventsRequest = Static<
  typeof AppendAgentEventsRequestSchema
>;
export type PendingAgentEvent = Static<typeof PendingAgentEventSchema>;
