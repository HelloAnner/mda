import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAgentConfig } from "./config.ts";

test("resolves Agent-only model credentials from mda.toml", () => {
  const directory = mkdtempSync(join(tmpdir(), "mda-agent-config-"));
  const path = join(directory, "mda.toml");
  writeFileSync(
    path,
    `[agent]
internal_token_env = "TEST_INTERNAL_TOKEN"
[agent.model]
provider = "openai-compatible"
model = "test-model"
base_url = "http://model.internal/v1"
api_key_env = "TEST_MODEL_API_KEY"
`,
  );

  try {
    expect(
      loadAgentConfig({
        MDA_CONFIG: path,
        TEST_INTERNAL_TOKEN: "test-internal-agent-token-32-bytes",
        TEST_MODEL_API_KEY: "secret-model-key",
      }),
    ).toEqual({
      internalAgentToken: "test-internal-agent-token-32-bytes",
      model: {
        provider: "openai-compatible",
        model: "test-model",
        baseUrl: "http://model.internal/v1",
        apiKey: "secret-model-key",
      },
    });
  } finally {
    rmSync(directory, { recursive: true });
  }
});
