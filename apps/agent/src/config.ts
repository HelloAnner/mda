import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

const EnvironmentNameSchema = Type.String({ pattern: "^[A-Z][A-Z0-9_]*$" });
const AgentFileSchema = Type.Object(
  {
    redis: Type.Object(
      { url_env: EnvironmentNameSchema },
      { additionalProperties: false },
    ),
    agent: Type.Object(
      {
        lease_ms: Type.Optional(
          Type.Integer({ minimum: 5_000, maximum: 300_000 }),
        ),
        workers: Type.Optional(Type.Integer({ minimum: 1, maximum: 64 })),
        internal_token_env: EnvironmentNameSchema,
        control_plane_url: Type.String({ minLength: 1 }),
        workspace_root: Type.Optional(Type.String({ minLength: 1 })),
        skills_root: Type.Optional(Type.String({ minLength: 1 })),
        model: Type.Object(
          {
            provider: Type.String({ minLength: 1 }),
            model: Type.String({ minLength: 1 }),
            base_url: Type.String({ minLength: 1 }),
            api_key_env: Type.Optional(EnvironmentNameSchema),
            api_key_file: Type.Optional(Type.String({ minLength: 1 })),
          },
          { additionalProperties: false },
        ),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: true },
);

export interface AgentConfig {
  internalAgentToken: string;
  controlPlaneUrl: string;
  redisUrl: string;
  workspaceRoot: string;
  skillsRoot: string;
  consumerId: string;
  leaseMs: number;
  workers: number;
  model: {
    provider: string;
    model: string;
    baseUrl: string;
    apiKey: string;
  };
}

export function loadAgentConfig(
  env: Record<string, string | undefined> = Bun.env,
): AgentConfig {
  const path = env.MDA_CONFIG ?? "mda.toml";
  let value: unknown;
  try {
    value = Bun.TOML.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(
      `Cannot load Agent configuration: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!Value.Check(AgentFileSchema, value)) {
    const errors = [...Value.Errors(AgentFileSchema, value)]
      .map(({ path: field, message }) => `${field || "/"} ${message}`)
      .join("; ");
    throw new Error(`Invalid Agent configuration: ${errors}`);
  }

  const model = value.agent.model;
  const internalAgentToken = env[value.agent.internal_token_env] ?? "";
  const redisUrl = env.REDIS_URL ?? env[value.redis.url_env] ?? "";
  const apiKeyEnvironment = env.MODEL_API_KEY_ENV ?? model.api_key_env;
  const apiKeyFile = env.MODEL_API_KEY_FILE ?? model.api_key_file;
  const apiKey =
    env.MODEL_API_KEY ??
    (apiKeyEnvironment ? env[apiKeyEnvironment] : undefined) ??
    (apiKeyFile
      ? readFileSync(
          isAbsolute(apiKeyFile)
            ? apiKeyFile
            : resolve(dirname(path), apiKeyFile),
          "utf8",
        ).trim()
      : undefined);
  if (internalAgentToken.length < 32) {
    throw new Error("Invalid Agent configuration: internal token is missing");
  }
  if (!apiKey) {
    throw new Error("Invalid Agent configuration: model API key is missing");
  }
  if (!/^rediss?:\/\//.test(redisUrl)) {
    throw new Error("Invalid Agent configuration: Redis URL is missing");
  }

  let baseUrl: URL;
  try {
    baseUrl = new URL(env.MDA_MODEL_BASE_URL ?? model.base_url);
  } catch {
    throw new Error("Invalid Agent configuration: model base_url is invalid");
  }
  if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
    throw new Error(
      "Invalid Agent configuration: model base_url must use HTTP(S)",
    );
  }
  if (baseUrl.username || baseUrl.password) {
    throw new Error(
      "Invalid Agent configuration: model credentials must not be embedded in base_url",
    );
  }

  const controlPlaneUrl = new URL(
    env.CONTROL_PLANE_INTERNAL_URL ?? value.agent.control_plane_url,
  );
  if (
    controlPlaneUrl.protocol !== "http:" &&
    controlPlaneUrl.protocol !== "https:"
  ) {
    throw new Error(
      "Invalid Agent configuration: control_plane_url must use HTTP(S)",
    );
  }

  const workers = Number(env.MDA_AGENT_WORKERS ?? value.agent.workers ?? 1);
  if (!Number.isInteger(workers) || workers < 1 || workers > 64) {
    throw new Error(
      "Invalid Agent configuration: workers must be from 1 to 64",
    );
  }

  return {
    internalAgentToken,
    controlPlaneUrl: controlPlaneUrl.href.replace(/\/$/, ""),
    redisUrl,
    workspaceRoot:
      env.MDA_AGENT_WORKSPACE_ROOT ??
      value.agent.workspace_root ??
      "/workspace",
    skillsRoot: resolve(
      dirname(path),
      env.MDA_AGENT_SKILLS_ROOT ??
        value.agent.skills_root ??
        "apps/agent/skills",
    ),
    consumerId: env.MDA_AGENT_CONSUMER ?? `${hostname()}-${process.pid}`,
    leaseMs: value.agent.lease_ms ?? 30_000,
    workers,
    model: {
      provider: env.MDA_MODEL_PROVIDER ?? model.provider,
      model: env.MDA_MODEL ?? model.model,
      baseUrl: baseUrl.href.replace(/\/$/, ""),
      apiKey,
    },
  };
}
