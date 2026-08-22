import { type Static, Type } from "@sinclair/typebox";
import { DashboardBuildArtifactSchema } from "../../../public/v1/previews.ts";

export const UploadDashboardPreviewRequestSchema = Type.Object(
  {
    owner: Type.String({ minLength: 1, maxLength: 200 }),
    fencingToken: Type.Integer({ minimum: 1 }),
    artifact: DashboardBuildArtifactSchema,
  },
  { additionalProperties: false },
);

export const UploadDashboardPreviewResponseSchema = Type.Object(
  {
    previewId: Type.String({ minLength: 1 }),
    path: Type.String({ minLength: 1 }),
    digest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  },
  { additionalProperties: false },
);

export type UploadDashboardPreviewRequest = Static<
  typeof UploadDashboardPreviewRequestSchema
>;
export type UploadDashboardPreviewResponse = Static<
  typeof UploadDashboardPreviewResponseSchema
>;
