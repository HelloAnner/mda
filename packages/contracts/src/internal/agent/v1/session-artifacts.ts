import { type Static, Type } from "@sinclair/typebox";

export const AgentSessionArtifactSchema = Type.Object(
  {
    digest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    bytes: Type.Integer({ minimum: 1, maximum: 20_971_520 }),
    content: Type.String({ minLength: 1, maxLength: 27_962_028 }),
  },
  { additionalProperties: false },
);

export const UploadAgentSessionArtifactRequestSchema = Type.Object(
  {
    owner: Type.String({ minLength: 1, maxLength: 200 }),
    fencingToken: Type.Integer({ minimum: 1 }),
    artifact: AgentSessionArtifactSchema,
  },
  { additionalProperties: false },
);

export const UploadAgentSessionArtifactResponseSchema = Type.Object(
  {
    digest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    bytes: Type.Integer({ minimum: 1, maximum: 20_971_520 }),
  },
  { additionalProperties: false },
);

export type AgentSessionArtifact = Static<typeof AgentSessionArtifactSchema>;
export type UploadAgentSessionArtifactRequest = Static<
  typeof UploadAgentSessionArtifactRequestSchema
>;
export type UploadAgentSessionArtifactResponse = Static<
  typeof UploadAgentSessionArtifactResponseSchema
>;
