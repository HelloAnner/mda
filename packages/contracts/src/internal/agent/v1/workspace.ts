import { type Static, Type } from "@sinclair/typebox";

export const SourceSnapshotFileSchema = Type.Object(
  {
    path: Type.String({ minLength: 1, maxLength: 240 }),
    content: Type.String({ maxLength: 2_796_204 }),
    executable: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const SourceSnapshotSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    digest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    fileCount: Type.Integer({ minimum: 0, maximum: 1_000 }),
    totalBytes: Type.Integer({ minimum: 0, maximum: 20 * 1024 * 1024 }),
    files: Type.Array(SourceSnapshotFileSchema, { maxItems: 1_000 }),
  },
  { additionalProperties: false },
);

export const AgentWorkspaceRestoreSchema = Type.Object(
  {
    checkpointId: Type.String({ minLength: 1 }),
    snapshot: SourceSnapshotSchema,
  },
  { additionalProperties: false },
);

export const CheckpointAgentWorkspaceRequestSchema = Type.Object(
  {
    owner: Type.String({ minLength: 1, maxLength: 200 }),
    fencingToken: Type.Integer({ minimum: 1 }),
    baseCheckpointId: Type.Optional(Type.String({ minLength: 1 })),
    snapshot: SourceSnapshotSchema,
  },
  { additionalProperties: false },
);

export const CheckpointAgentWorkspaceResponseSchema = Type.Object(
  {
    created: Type.Boolean(),
    checkpointId: Type.String({ minLength: 1 }),
    digest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  },
  { additionalProperties: false },
);

export type AgentWorkspaceRestore = Static<typeof AgentWorkspaceRestoreSchema>;
export type CheckpointAgentWorkspaceRequest = Static<
  typeof CheckpointAgentWorkspaceRequestSchema
>;
export type CheckpointAgentWorkspaceResponse = Static<
  typeof CheckpointAgentWorkspaceResponseSchema
>;
export type SourceSnapshot = Static<typeof SourceSnapshotSchema>;
export type SourceSnapshotFile = Static<typeof SourceSnapshotFileSchema>;
