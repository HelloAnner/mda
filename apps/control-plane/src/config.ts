import { existsSync, readFileSync } from "node:fs";
import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

const EnvironmentNameSchema = Type.String({ pattern: "^[A-Z][A-Z0-9_]*$" });

const GlobalConfigFileSchema = Type.Object(
  {
    server: Type.Optional(
      Type.Object(
        {
          host: Type.Optional(Type.String({ minLength: 1 })),
          port: Type.Optional(Type.Integer({ minimum: 1, maximum: 65_535 })),
          access_password_env: Type.Optional(EnvironmentNameSchema),
        },
        { additionalProperties: false },
      ),
    ),
    database: Type.Optional(
      Type.Object(
        { url_env: Type.Optional(EnvironmentNameSchema) },
        { additionalProperties: false },
      ),
    ),
    redis: Type.Optional(
      Type.Object(
        { url_env: Type.Optional(EnvironmentNameSchema) },
        { additionalProperties: false },
      ),
    ),
    artifacts: Type.Optional(
      Type.Object(
        {
          endpoint: Type.Optional(Type.String({ minLength: 1 })),
          bucket: Type.Optional(Type.String({ minLength: 3, maxLength: 63 })),
          region: Type.Optional(Type.String({ minLength: 1 })),
          access_key_env: Type.Optional(EnvironmentNameSchema),
          secret_key_env: Type.Optional(EnvironmentNameSchema),
        },
        { additionalProperties: false },
      ),
    ),
    auth: Type.Optional(
      Type.Object(
        {
          mode: Type.Optional(
            Type.Union([Type.Literal("oidc"), Type.Literal("password")]),
          ),
          tenant_id: Type.Optional(Type.String({ minLength: 1 })),
          user_id: Type.Optional(Type.String({ minLength: 1 })),
        },
        { additionalProperties: false },
      ),
    ),
    oidc: Type.Optional(
      Type.Object(
        {
          issuer: Type.Optional(Type.String({ minLength: 1 })),
          audience: Type.Optional(Type.String({ minLength: 1 })),
          jwks_url: Type.Optional(Type.String({ minLength: 1 })),
        },
        { additionalProperties: false },
      ),
    ),
    agent: Type.Optional(
      Type.Object(
        {
          lease_ms: Type.Optional(
            Type.Integer({ minimum: 5_000, maximum: 300_000 }),
          ),
          workers: Type.Optional(Type.Integer({ minimum: 1, maximum: 64 })),
          internal_token_env: Type.Optional(EnvironmentNameSchema),
          control_plane_url: Type.Optional(Type.String({ minLength: 1 })),
          workspace_root: Type.Optional(Type.String({ minLength: 1 })),
          skills_root: Type.Optional(Type.String({ minLength: 1 })),
          model: Type.Optional(
            Type.Object(
              {
                provider: Type.String({ minLength: 1 }),
                model: Type.String({ minLength: 1 }),
                base_url: Type.String({ minLength: 1 }),
                api_key_env: Type.Optional(EnvironmentNameSchema),
                api_key_file: Type.Optional(Type.String({ minLength: 1 })),
              },
              { additionalProperties: false },
            ),
          ),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

type GlobalConfigFile = Static<typeof GlobalConfigFileSchema>;

const ConfigSchema = Type.Object(
  {
    hostname: Type.String({ minLength: 1 }),
    port: Type.Integer({ minimum: 1, maximum: 65_535 }),
    databaseUrl: Type.String({ pattern: "^postgres(ql)?://" }),
    redisUrl: Type.String({ pattern: "^rediss?://" }),
    artifactEndpoint: Type.String({ pattern: "^https?://" }),
    artifactBucket: Type.String({
      minLength: 3,
      maxLength: 63,
      pattern: "^[a-z0-9][a-z0-9.-]*[a-z0-9]$",
    }),
    artifactRegion: Type.String({ minLength: 1 }),
    artifactAccessKeyId: Type.String({ minLength: 3 }),
    artifactSecretAccessKey: Type.String({ minLength: 8 }),
    authMode: Type.Union([Type.Literal("oidc"), Type.Literal("password")]),
    localTenantId: Type.String({ minLength: 1 }),
    localUserId: Type.String({ minLength: 1 }),
    oidcIssuer: Type.Optional(Type.String({ minLength: 1 })),
    oidcAudience: Type.Optional(Type.String({ minLength: 1 })),
    oidcJwksUrl: Type.Optional(Type.String({ minLength: 1 })),
    internalAgentToken: Type.String({ minLength: 32 }),
    agentLeaseMs: Type.Integer({ minimum: 5_000, maximum: 300_000 }),
    accessPassword: Type.String({ minLength: 16 }),
  },
  { additionalProperties: false },
);

export interface Config {
  hostname: string;
  port: number;
  databaseUrl: string;
  redisUrl: string;
  artifactEndpoint: string;
  artifactBucket: string;
  artifactRegion: string;
  artifactAccessKeyId: string;
  artifactSecretAccessKey: string;
  authMode: "oidc" | "password";
  localTenantId: string;
  localUserId: string;
  oidcIssuer?: string;
  oidcAudience?: string;
  oidcJwksUrl?: string;
  internalAgentToken: string;
  agentLeaseMs: number;
  accessPassword: string;
}

function validationErrors(schema: typeof ConfigSchema, value: unknown): string {
  return [...Value.Errors(schema, value)]
    .map(({ path, message }) => `${path || "/"} ${message}`)
    .join("; ");
}

function readGlobalConfig(path: string, required: boolean): GlobalConfigFile {
  if (!existsSync(path)) {
    if (required) throw new Error(`Configuration file not found: ${path}`);
    return {};
  }

  let value: unknown;
  try {
    value = Bun.TOML.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(
      `Invalid configuration file: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!Value.Check(GlobalConfigFileSchema, value)) {
    const errors = [...Value.Errors(GlobalConfigFileSchema, value)]
      .map(({ path: field, message }) => `${field || "/"} ${message}`)
      .join("; ");
    throw new Error(`Invalid configuration file: ${errors}`);
  }
  if (
    value.agent?.model &&
    !value.agent.model.api_key_env &&
    !value.agent.model.api_key_file
  ) {
    throw new Error(
      "Invalid configuration file: agent.model requires api_key_env or api_key_file",
    );
  }
  return value;
}

export function loadConfig(
  env: Record<string, string | undefined> = Bun.env,
): Config {
  const path = env.MDA_CONFIG ?? "mda.toml";
  const file = readGlobalConfig(path, Boolean(env.MDA_CONFIG));
  const databaseUrlEnv = file.database?.url_env ?? "DATABASE_URL";
  const redisUrlEnv = file.redis?.url_env ?? "REDIS_URL";
  const accessPasswordEnv =
    file.server?.access_password_env ?? "MDA_ACCESS_PASSWORD";
  const artifactAccessKeyEnv =
    file.artifacts?.access_key_env ?? "S3_ACCESS_KEY_ID";
  const artifactSecretKeyEnv =
    file.artifacts?.secret_key_env ?? "S3_SECRET_ACCESS_KEY";
  const internalTokenEnv =
    file.agent?.internal_token_env ?? "INTERNAL_AGENT_TOKEN";
  const config = {
    hostname: env.HOST ?? file.server?.host ?? "0.0.0.0",
    port: Number(env.PORT ?? file.server?.port ?? 8080),
    databaseUrl: env.DATABASE_URL ?? env[databaseUrlEnv] ?? "",
    redisUrl: env.REDIS_URL ?? env[redisUrlEnv] ?? "",
    artifactEndpoint:
      env.S3_ENDPOINT ?? file.artifacts?.endpoint ?? "http://localhost:9000",
    artifactBucket: env.S3_BUCKET ?? file.artifacts?.bucket ?? "mda-artifacts",
    artifactRegion: env.S3_REGION ?? file.artifacts?.region ?? "us-east-1",
    artifactAccessKeyId:
      env.S3_ACCESS_KEY_ID ?? env[artifactAccessKeyEnv] ?? "",
    artifactSecretAccessKey:
      env.S3_SECRET_ACCESS_KEY ?? env[artifactSecretKeyEnv] ?? "",
    authMode: env.MDA_AUTH_MODE ?? file.auth?.mode ?? "oidc",
    localTenantId: env.MDA_LOCAL_TENANT ?? file.auth?.tenant_id ?? "local",
    localUserId: env.MDA_LOCAL_USER ?? file.auth?.user_id ?? "local-admin",
    ...((env.OIDC_ISSUER ?? file.oidc?.issuer)
      ? { oidcIssuer: env.OIDC_ISSUER ?? file.oidc?.issuer }
      : {}),
    ...((env.OIDC_AUDIENCE ?? file.oidc?.audience)
      ? { oidcAudience: env.OIDC_AUDIENCE ?? file.oidc?.audience }
      : {}),
    ...((env.OIDC_JWKS_URL ?? file.oidc?.jwks_url)
      ? { oidcJwksUrl: env.OIDC_JWKS_URL ?? file.oidc?.jwks_url }
      : {}),
    internalAgentToken: env.INTERNAL_AGENT_TOKEN ?? env[internalTokenEnv] ?? "",
    agentLeaseMs: Number(env.AGENT_LEASE_MS ?? file.agent?.lease_ms ?? 30_000),
    accessPassword: env.MDA_ACCESS_PASSWORD ?? env[accessPasswordEnv] ?? "",
  };

  if (!Value.Check(ConfigSchema, config)) {
    throw new Error(
      `Invalid configuration: ${validationErrors(ConfigSchema, config)}`,
    );
  }
  const artifactEndpoint = new URL(config.artifactEndpoint);
  if (artifactEndpoint.username || artifactEndpoint.password) {
    throw new Error(
      "Invalid configuration: artifact credentials must not be embedded in endpoint",
    );
  }
  if (
    config.authMode === "oidc" &&
    (!config.oidcIssuer || !config.oidcAudience || !config.oidcJwksUrl)
  ) {
    throw new Error("Invalid configuration: OIDC settings are required");
  }
  return config;
}
