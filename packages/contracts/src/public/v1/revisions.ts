import { type Static, Type } from "@sinclair/typebox";

export const DashboardRevisionSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    dashboardId: Type.String({ minLength: 1 }),
    number: Type.Integer({ minimum: 1 }),
    digest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    fileCount: Type.Integer({ minimum: 1, maximum: 1_000 }),
    totalBytes: Type.Integer({ minimum: 0, maximum: 20 * 1024 * 1024 }),
    message: Type.Optional(Type.String({ maxLength: 500 })),
    createdAt: Type.String({ minLength: 1 }),
  },
  { $id: "DashboardRevisionV1", additionalProperties: false },
);

export const CreateDashboardRevisionRequestSchema = Type.Object(
  { message: Type.Optional(Type.String({ maxLength: 500 })) },
  { $id: "CreateDashboardRevisionRequestV1", additionalProperties: false },
);

export const DashboardRevisionListResponseSchema = Type.Object(
  { items: Type.Array(DashboardRevisionSchema, { maxItems: 100 }) },
  { $id: "DashboardRevisionListResponseV1", additionalProperties: false },
);

export const DashboardRevisionFileSchema = Type.Object(
  {
    path: Type.String({ minLength: 1, maxLength: 240 }),
    size: Type.Integer({ minimum: 0, maximum: 2 * 1024 * 1024 }),
    digest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    executable: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const DashboardRevisionFileListResponseSchema = Type.Object(
  { items: Type.Array(DashboardRevisionFileSchema, { maxItems: 1_000 }) },
  { $id: "DashboardRevisionFileListResponseV1", additionalProperties: false },
);

export type CreateDashboardRevisionRequest = Static<
  typeof CreateDashboardRevisionRequestSchema
>;
export type DashboardRevision = Static<typeof DashboardRevisionSchema>;
export type DashboardRevisionFile = Static<typeof DashboardRevisionFileSchema>;
export type DashboardRevisionFileListResponse = Static<
  typeof DashboardRevisionFileListResponseSchema
>;
export type DashboardRevisionListResponse = Static<
  typeof DashboardRevisionListResponseSchema
>;
