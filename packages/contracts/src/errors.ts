import { type Static, Type } from "@sinclair/typebox";

export const ApiErrorSchema = Type.Object(
  {
    code: Type.String({ minLength: 1 }),
    message: Type.String({ minLength: 1 }),
    requestId: Type.String({ minLength: 1 }),
    retryable: Type.Boolean(),
    details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { $id: "ApiError", additionalProperties: false },
);

export type ApiError = Static<typeof ApiErrorSchema>;
