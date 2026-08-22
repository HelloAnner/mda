import { type Static, Type } from "@sinclair/typebox";
import { AgentJobSchema, AgentTerminalErrorSchema } from "./agent-work.ts";

const DigestSchema = Type.String({ pattern: "^[a-f0-9]{64}$" });
const RelativePathSchema = Type.String({ minLength: 1, maxLength: 500 });
const QueryParameterTypeSchema = Type.Union([
  Type.Literal("string"),
  Type.Literal("integer"),
  Type.Literal("number"),
  Type.Literal("boolean"),
  Type.Literal("date"),
  Type.Literal("datetime"),
]);

export const DashboardManifestSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    title: Type.String({ minLength: 1, maxLength: 200 }),
    description: Type.Optional(Type.String({ maxLength: 2_000 })),
    sourceEntry: RelativePathSchema,
    entry: Type.Literal("dist/index.html"),
    runtimeVersion: Type.Literal("1"),
    queries: Type.Array(
      Type.Object(
        {
          id: Type.String({ minLength: 1, maxLength: 200 }),
          revision: Type.Integer({ minimum: 1 }),
          parameters: Type.Record(
            Type.String({ minLength: 1, maxLength: 100 }),
            QueryParameterTypeSchema,
          ),
        },
        { additionalProperties: false },
      ),
      { maxItems: 100 },
    ),
  },
  { $id: "DashboardManifestV1", additionalProperties: false },
);

export const DashboardBuildFileSchema = Type.Object(
  {
    path: RelativePathSchema,
    content: Type.String({ maxLength: 69_905_068 }),
    mediaType: Type.String({ minLength: 1, maxLength: 100 }),
  },
  { additionalProperties: false },
);

export const DashboardBuildArtifactSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    sourceDigest: DigestSchema,
    manifestDigest: DigestSchema,
    digest: DigestSchema,
    templateVersion: Type.Literal("1"),
    runtimeVersion: Type.Literal("1"),
    fileCount: Type.Integer({ minimum: 1, maximum: 1_000 }),
    totalBytes: Type.Integer({ minimum: 1, maximum: 52_428_800 }),
    manifest: DashboardManifestSchema,
    files: Type.Array(DashboardBuildFileSchema, {
      minItems: 1,
      maxItems: 1_000,
    }),
  },
  { additionalProperties: false },
);

export const DashboardValidationIssueSchema = Type.Object(
  {
    code: Type.String({ minLength: 1, maxLength: 100 }),
    message: Type.String({ minLength: 1, maxLength: 2_000 }),
    path: Type.Optional(RelativePathSchema),
  },
  { additionalProperties: false },
);

export const DashboardPreviewSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    dashboardId: Type.String({ minLength: 1 }),
    jobId: Type.String({ minLength: 1 }),
    sourceCheckpointId: Type.String({ minLength: 1 }),
    sourceRevisionId: Type.Optional(Type.String({ minLength: 1 })),
    sourceDigest: DigestSchema,
    status: Type.Union([
      Type.Literal("building"),
      Type.Literal("ready"),
      Type.Literal("failed"),
      Type.Literal("expired"),
    ]),
    templateVersion: Type.Literal("1"),
    runtimeVersion: Type.Literal("1"),
    manifestDigest: Type.Optional(DigestSchema),
    buildDigest: Type.Optional(DigestSchema),
    fileCount: Type.Optional(Type.Integer({ minimum: 1, maximum: 1_000 })),
    totalBytes: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 52_428_800 }),
    ),
    error: Type.Optional(AgentTerminalErrorSchema),
    url: Type.String({ minLength: 1 }),
    expiresAt: Type.String({ minLength: 1 }),
    createdAt: Type.String({ minLength: 1 }),
    completedAt: Type.Optional(Type.String({ minLength: 1 })),
  },
  { $id: "DashboardPreviewV1", additionalProperties: false },
);

export const CreateDashboardPreviewRequestSchema = Type.Object(
  { revisionId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })) },
  { additionalProperties: false },
);

export const CreateDashboardPreviewResponseSchema = Type.Object(
  { preview: DashboardPreviewSchema, job: AgentJobSchema },
  { additionalProperties: false },
);

export const DashboardPreviewListResponseSchema = Type.Object(
  { items: Type.Array(DashboardPreviewSchema) },
  { additionalProperties: false },
);

export type CreateDashboardPreviewRequest = Static<
  typeof CreateDashboardPreviewRequestSchema
>;
export type CreateDashboardPreviewResponse = Static<
  typeof CreateDashboardPreviewResponseSchema
>;
export type DashboardBuildArtifact = Static<
  typeof DashboardBuildArtifactSchema
>;
export type DashboardBuildFile = Static<typeof DashboardBuildFileSchema>;
export type DashboardManifest = Static<typeof DashboardManifestSchema>;
export type DashboardPreview = Static<typeof DashboardPreviewSchema>;
export type DashboardPreviewListResponse = Static<
  typeof DashboardPreviewListResponseSchema
>;
export type DashboardValidationIssue = Static<
  typeof DashboardValidationIssueSchema
>;
