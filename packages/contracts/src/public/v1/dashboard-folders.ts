import { type Static, Type } from "@sinclair/typebox";

export const DashboardFolderSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1, maxLength: 100 }),
    parentId: Type.Optional(Type.String({ minLength: 1 })),
    version: Type.Integer({ minimum: 1 }),
    createdAt: Type.String({ minLength: 1 }),
    updatedAt: Type.String({ minLength: 1 }),
  },
  { $id: "DashboardFolderV1", additionalProperties: false },
);

export const DashboardFolderListResponseSchema = Type.Object(
  { items: Type.Array(DashboardFolderSchema, { maxItems: 500 }) },
  { $id: "DashboardFolderListResponseV1", additionalProperties: false },
);

export const CreateDashboardFolderRequestSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 100, pattern: "\\S" }),
    parentId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  },
  { $id: "CreateDashboardFolderRequestV1", additionalProperties: false },
);

export const UpdateDashboardFolderRequestSchema = Type.Object(
  {
    name: Type.Optional(
      Type.String({ minLength: 1, maxLength: 100, pattern: "\\S" }),
    ),
    parentId: Type.Optional(
      Type.Union([Type.String({ minLength: 1, maxLength: 200 }), Type.Null()]),
    ),
    expectedVersion: Type.Integer({ minimum: 1 }),
  },
  { $id: "UpdateDashboardFolderRequestV1", additionalProperties: false },
);

export const DeleteDashboardFolderRequestSchema = Type.Object(
  { expectedVersion: Type.Integer({ minimum: 1 }) },
  { $id: "DeleteDashboardFolderRequestV1", additionalProperties: false },
);

export type CreateDashboardFolderRequest = Static<
  typeof CreateDashboardFolderRequestSchema
>;
export type DashboardFolder = Static<typeof DashboardFolderSchema>;
export type DashboardFolderListResponse = Static<
  typeof DashboardFolderListResponseSchema
>;
export type DeleteDashboardFolderRequest = Static<
  typeof DeleteDashboardFolderRequestSchema
>;
export type UpdateDashboardFolderRequest = Static<
  typeof UpdateDashboardFolderRequestSchema
>;
