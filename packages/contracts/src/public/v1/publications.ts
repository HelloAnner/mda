import { type Static, Type } from "@sinclair/typebox";
import { AgentJobSchema, AgentTerminalErrorSchema } from "./agent-work.ts";

const DigestSchema = Type.String({ pattern: "^[a-f0-9]{64}$" });

export const PublicationBuildSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    dashboardId: Type.String({ minLength: 1 }),
    revisionId: Type.String({ minLength: 1 }),
    jobId: Type.String({ minLength: 1 }),
    sourceDigest: DigestSchema,
    status: Type.Union([
      Type.Literal("building"),
      Type.Literal("ready"),
      Type.Literal("failed"),
    ]),
    publicationId: Type.Optional(Type.String({ minLength: 1 })),
    error: Type.Optional(AgentTerminalErrorSchema),
    createdAt: Type.String({ minLength: 1 }),
    completedAt: Type.Optional(Type.String({ minLength: 1 })),
  },
  { $id: "PublicationBuildV1", additionalProperties: false },
);

export const PublicationSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    dashboardId: Type.String({ minLength: 1 }),
    revisionId: Type.String({ minLength: 1 }),
    number: Type.Integer({ minimum: 1 }),
    sourceDigest: DigestSchema,
    manifestDigest: DigestSchema,
    buildDigest: DigestSchema,
    templateVersion: Type.Literal("1"),
    runtimeVersion: Type.Literal("1"),
    fileCount: Type.Integer({ minimum: 1, maximum: 1_000 }),
    totalBytes: Type.Integer({ minimum: 1, maximum: 52_428_800 }),
    createdAt: Type.String({ minLength: 1 }),
  },
  { $id: "PublicationV1", additionalProperties: false },
);

export const CreatePublicationRequestSchema = Type.Object(
  { revisionId: Type.String({ minLength: 1, maxLength: 200 }) },
  { additionalProperties: false },
);

export const CreatePublicationResponseSchema = Type.Object(
  { build: PublicationBuildSchema, job: AgentJobSchema },
  { additionalProperties: false },
);

export const PublicationBuildListResponseSchema = Type.Object(
  { items: Type.Array(PublicationBuildSchema) },
  { additionalProperties: false },
);

export const PublicationListResponseSchema = Type.Object(
  { items: Type.Array(PublicationSchema) },
  { additionalProperties: false },
);

export type CreatePublicationRequest = Static<
  typeof CreatePublicationRequestSchema
>;
export type CreatePublicationResponse = Static<
  typeof CreatePublicationResponseSchema
>;
export type Publication = Static<typeof PublicationSchema>;
export type PublicationBuild = Static<typeof PublicationBuildSchema>;
export type PublicationBuildListResponse = Static<
  typeof PublicationBuildListResponseSchema
>;
export type PublicationListResponse = Static<
  typeof PublicationListResponseSchema
>;
