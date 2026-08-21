import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

const ConfigSchema = Type.Object(
  {
    hostname: Type.String({ minLength: 1 }),
    port: Type.Integer({ minimum: 1, maximum: 65_535 }),
    databaseUrl: Type.String({ pattern: "^postgres(ql)?://" }),
    oidcIssuer: Type.String({ minLength: 1 }),
    oidcAudience: Type.String({ minLength: 1 }),
    oidcJwksUrl: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export interface Config {
  hostname: string;
  port: number;
  databaseUrl: string;
  oidcIssuer: string;
  oidcAudience: string;
  oidcJwksUrl: string;
}

export function loadConfig(
  env: Record<string, string | undefined> = Bun.env,
): Config {
  const config = {
    hostname: env.HOST ?? "0.0.0.0",
    port: Number(env.PORT ?? 8080),
    databaseUrl: env.DATABASE_URL ?? "",
    oidcIssuer: env.OIDC_ISSUER ?? "",
    oidcAudience: env.OIDC_AUDIENCE ?? "",
    oidcJwksUrl: env.OIDC_JWKS_URL ?? "",
  };

  if (!Value.Check(ConfigSchema, config)) {
    const errors = [...Value.Errors(ConfigSchema, config)]
      .map(({ path, message }) => `${path || "/"} ${message}`)
      .join("; ");
    throw new Error(`Invalid configuration: ${errors}`);
  }
  return config;
}
