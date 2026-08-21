import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

const EnvironmentNameSchema = Type.String({ pattern: "^[A-Z][A-Z0-9_]*$" });
const AgentFileSchema = Type.Object(
  {
    agent: Type.Object(
      {
        lease_ms: Type.Optional(Type.Integer()),
        internal_token_env: EnvironmentNameSchema,
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

  return {
    internalAgentToken,
    model: {
      provider: model.provider,
      model: model.model,
      baseUrl: baseUrl.href.replace(/\/$/, ""),
      apiKey,
    },
  };
}
