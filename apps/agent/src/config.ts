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
        internal_token_env: EnvironmentNameSchema,
        control_plane_url: Type.String({ minLength: 1 }),
        workspace_root: Type.Optional(Type.String({ minLength: 1 })),
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
  consumerId: string;
  leaseMs: number;
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
  const apiKey = model.api_key_env
    ? env[model.api_key_env]
    : model.api_key_file
      ? readFileSync(
          isAbsolute(model.api_key_file)
            ? model.api_key_file
            : resolve(dirname(path), model.api_key_file),
          "utf8",
        ).trim()
      : undefined;
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
    baseUrl = new URL(model.base_url);
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

  const controlPlaneUrl = new URL(value.agent.control_plane_url);
  if (
    controlPlaneUrl.protocol !== "http:" &&
    controlPlaneUrl.protocol !== "https:"
  ) {
    throw new Error(
      "Invalid Agent configuration: control_plane_url must use HTTP(S)",
    );
  }

  return {
    internalAgentToken,
    controlPlaneUrl: controlPlaneUrl.href.replace(/\/$/, ""),
    redisUrl,
    workspaceRoot: value.agent.workspace_root ?? "/workspace",
    consumerId: env.MDA_AGENT_CONSUMER ?? `${hostname()}-${process.pid}`,
    leaseMs: value.agent.lease_ms ?? 30_000,
    model: {
      provider: model.provider,
      model: model.model,
      baseUrl: baseUrl.href.replace(/\/$/, ""),
      apiKey,
    },
  };
}
