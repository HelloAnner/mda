import { type Static, Type } from "@sinclair/typebox";

export const ShareLinkSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    dashboardId: Type.String({ minLength: 1 }),
    publicationId: Type.String({ minLength: 1 }),
    access: Type.Literal("public"),
    status: Type.Union([
      Type.Literal("active"),
      Type.Literal("revoked"),
      Type.Literal("expired"),
    ]),
    version: Type.Integer({ minimum: 1 }),
    expiresAt: Type.Optional(Type.String({ minLength: 1 })),
    createdAt: Type.String({ minLength: 1 }),
    revokedAt: Type.Optional(Type.String({ minLength: 1 })),
  },
  { $id: "ShareLinkV1", additionalProperties: false },
);

export const CreateShareLinkRequestSchema = Type.Object(
  {
    expiresInSeconds: Type.Optional(
      Type.Integer({ minimum: 60, maximum: 31_536_000 }),
    ),
  },
  { additionalProperties: false },
);

export const CreateShareLinkResponseSchema = Type.Object(
  {
    shareLink: ShareLinkSchema,
    url: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export const ShareLinkListResponseSchema = Type.Object(
  { items: Type.Array(ShareLinkSchema) },
  { additionalProperties: false },
);

export type CreateShareLinkRequest = Static<
  typeof CreateShareLinkRequestSchema
>;
export type CreateShareLinkResponse = Static<
  typeof CreateShareLinkResponseSchema
>;
export type ShareLink = Static<typeof ShareLinkSchema>;
export type ShareLinkListResponse = Static<typeof ShareLinkListResponseSchema>;
