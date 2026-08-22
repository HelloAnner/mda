import { type Static, Type } from "@sinclair/typebox";
import { DashboardBuildArtifactSchema } from "../../../public/v1/previews.ts";

export const UploadPublicationRequestSchema = Type.Object(
  {
    owner: Type.String({ minLength: 1, maxLength: 200 }),
    fencingToken: Type.Integer({ minimum: 1 }),
    artifact: DashboardBuildArtifactSchema,
  },
  { additionalProperties: false },
);

export const UploadPublicationResponseSchema = Type.Object(
  {
    publicationId: Type.String({ minLength: 1 }),
    number: Type.Integer({ minimum: 1 }),
    digest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  },
  { additionalProperties: false },
);

export type UploadPublicationRequest = Static<
  typeof UploadPublicationRequestSchema
>;
export type UploadPublicationResponse = Static<
  typeof UploadPublicationResponseSchema
>;
