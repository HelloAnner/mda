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
    `[redis]
url_env = "TEST_REDIS_URL"
[agent]
internal_token_env = "TEST_INTERNAL_TOKEN"
lease_ms = 30000
control_plane_url = "http://main:8080"
workspace_root = "/tmp/mda-workspace"
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
        TEST_REDIS_URL: "redis://redis:6379",
        MDA_AGENT_CONSUMER: "agent-test",
      }),
    ).toEqual({
      internalAgentToken: "test-internal-agent-token-32-bytes",
      controlPlaneUrl: "http://main:8080",
      redisUrl: "redis://redis:6379",
      workspaceRoot: "/tmp/mda-workspace",
      consumerId: "agent-test",
      leaseMs: 30_000,
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
