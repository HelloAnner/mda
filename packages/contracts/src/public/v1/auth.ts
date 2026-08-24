import { type Static, Type } from "@sinclair/typebox";

export const RegisterRequestSchema = Type.Object(
  {
    username: Type.String({ minLength: 1, maxLength: 200 }),
    password: Type.String({ minLength: 1, maxLength: 500 }),
  },
  { $id: "RegisterRequestV1", additionalProperties: false },
);

export const LoginRequestSchema = Type.Object(
  {
    username: Type.String({ minLength: 1, maxLength: 200 }),
    password: Type.String({ minLength: 1, maxLength: 500 }),
  },
  { $id: "LoginRequestV1", additionalProperties: false },
);

export const AuthUserSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    username: Type.String({ minLength: 1 }),
    tenantId: Type.String({ minLength: 1 }),
  },
  { $id: "AuthUserV1", additionalProperties: false },
);

export const AuthMeResponseSchema = Type.Object(
  {
    user: AuthUserSchema,
  },
  { $id: "AuthMeResponseV1", additionalProperties: false },
);

export type RegisterRequest = Static<typeof RegisterRequestSchema>;
export type LoginRequest = Static<typeof LoginRequestSchema>;
export type AuthUser = Static<typeof AuthUserSchema>;
export type AuthMeResponse = Static<typeof AuthMeResponseSchema>;
