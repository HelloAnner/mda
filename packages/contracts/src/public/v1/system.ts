import { type Static, Type } from "@sinclair/typebox";

export const CONTRACT_VERSION = "1" as const;

export const HealthResponseSchema = Type.Object(
  {
    service: Type.String({ minLength: 1 }),
    status: Type.Literal("ok"),
    version: Type.String({ minLength: 1 }),
  },
  { $id: "HealthResponseV1", additionalProperties: false },
);

export const ServiceMetadataSchema = Type.Object(
  {
    service: Type.String({ minLength: 1 }),
    version: Type.String({ minLength: 1 }),
    contractVersion: Type.Literal(CONTRACT_VERSION),
  },
  { $id: "ServiceMetadataV1", additionalProperties: false },
);

export type HealthResponse = Static<typeof HealthResponseSchema>;
export type ServiceMetadata = Static<typeof ServiceMetadataSchema>;
