import { type Static, Type } from "@sinclair/typebox";

export const DashboardSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1, maxLength: 100 }),
    description: Type.Optional(Type.String({ maxLength: 1000 })),
    status: Type.Union([Type.Literal("active"), Type.Literal("archived")]),
    version: Type.Integer({ minimum: 1 }),
    createdAt: Type.String({ minLength: 1 }),
    updatedAt: Type.String({ minLength: 1 }),
  },
  { $id: "DashboardV1", additionalProperties: false },
);

export const CreateDashboardRequestSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 100, pattern: "\\S" }),
    description: Type.Optional(Type.String({ maxLength: 1000 })),
  },
  { $id: "CreateDashboardRequestV1", additionalProperties: false },
);

export const DashboardListResponseSchema = Type.Object(
  { items: Type.Array(DashboardSchema, { maxItems: 100 }) },
  { $id: "DashboardListResponseV1", additionalProperties: false },
);

export type CreateDashboardRequest = Static<
  typeof CreateDashboardRequestSchema
>;
export type Dashboard = Static<typeof DashboardSchema>;
export type DashboardListResponse = Static<typeof DashboardListResponseSchema>;
