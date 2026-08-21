import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAgentConfig } from "./config.ts";

test("resolves Agent container overrides and its secret file", () => {
  const directory = mkdtempSync(join(tmpdir(), "mda-agent-config-"));
  const path = join(directory, "mda.toml");
  const secretPath = join(directory, "model-key");
  writeFileSync(secretPath, "secret-model-key\n");
  writeFileSync(
    path,
    `[redis]
url_env = "TEST_REDIS_URL"
[agent]
internal_token_env = "TEST_INTERNAL_TOKEN"
lease_ms = 30000
workers = 3
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
        TEST_REDIS_URL: "redis://redis:6379",
        MODEL_API_KEY_FILE: secretPath,
        CONTROL_PLANE_INTERNAL_URL: "http://container-main:8080",
        MDA_AGENT_WORKSPACE_ROOT: "/workspace",
        MDA_AGENT_WORKERS: "4",
        MDA_MODEL_PROVIDER: "container-provider",
        MDA_MODEL: "container-model",
        MDA_MODEL_BASE_URL: "https://container-model.example/v1",
        MDA_AGENT_CONSUMER: "agent-test",
      }),
    ).toEqual({
      internalAgentToken: "test-internal-agent-token-32-bytes",
      controlPlaneUrl: "http://container-main:8080",
      redisUrl: "redis://redis:6379",
      workspaceRoot: "/workspace",
      consumerId: "agent-test",
      leaseMs: 30_000,
      workers: 4,
      model: {
        provider: "container-provider",
        model: "container-model",
        baseUrl: "https://container-model.example/v1",
        apiKey: "secret-model-key",
      },
    });
  } finally {
    rmSync(directory, { recursive: true });
  }
});
