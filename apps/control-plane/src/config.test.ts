import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.ts";

const valid = {
  HOST: "0.0.0.0",
  DATABASE_URL: "postgres://mda:test@localhost/mda",
  REDIS_URL: "redis://localhost:6379",
  OIDC_ISSUER: "https://identity.example",
  OIDC_AUDIENCE: "mda",
  OIDC_JWKS_URL: "https://identity.example/.well-known/jwks.json",
  INTERNAL_AGENT_TOKEN: "test-internal-agent-token-32-bytes",
  MDA_ACCESS_PASSWORD: "test-global-password",
  MDA_AUTH_MODE: "oidc",
};

test("loads and converts startup configuration", () => {
  expect(loadConfig({ ...valid, PORT: "9090" })).toEqual({
    hostname: "0.0.0.0",
    port: 9090,
    databaseUrl: valid.DATABASE_URL,
    redisUrl: valid.REDIS_URL,
    authMode: "oidc",
    localTenantId: "local",
    localUserId: "local-admin",
    oidcIssuer: valid.OIDC_ISSUER,
    oidcAudience: valid.OIDC_AUDIENCE,
    oidcJwksUrl: valid.OIDC_JWKS_URL,
    internalAgentToken: valid.INTERNAL_AGENT_TOKEN,
    agentLeaseMs: 30_000,
    accessPassword: valid.MDA_ACCESS_PASSWORD,
  });
});

test("loads deployment and model references from mda.toml", () => {
  const directory = mkdtempSync(join(tmpdir(), "mda-config-"));
  const path = join(directory, "mda.toml");
  writeFileSync(
    path,
    `[server]
port = 9091
access_password_env = "TEST_ACCESS_PASSWORD"
[database]
url_env = "TEST_DATABASE_URL"
[redis]
url_env = "TEST_REDIS_URL"
[oidc]
issuer = "https://identity.example"
audience = "mda"
jwks_url = "https://identity.example/jwks.json"
[agent]
internal_token_env = "TEST_INTERNAL_TOKEN"
lease_ms = 45000
[agent.model]
provider = "openai-compatible"
model = "test-model"
base_url = "https://llm.example/v1"
api_key_env = "TEST_MODEL_API_KEY"
`,
  );

  try {
    expect(
      loadConfig({
        MDA_CONFIG: path,
        TEST_DATABASE_URL: valid.DATABASE_URL,
        TEST_REDIS_URL: valid.REDIS_URL,
        TEST_INTERNAL_TOKEN: valid.INTERNAL_AGENT_TOKEN,
        TEST_ACCESS_PASSWORD: valid.MDA_ACCESS_PASSWORD,
      }),
    ).toMatchObject({
      port: 9091,
      agentLeaseMs: 45_000,
      accessPassword: valid.MDA_ACCESS_PASSWORD,
    });
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("accepts the checked-in global configuration template", () => {
  expect(
    loadConfig({
      ...valid,
      MDA_AUTH_MODE: undefined,
      MDA_CONFIG: new URL("../../../mda.example.toml", import.meta.url)
        .pathname,
    }),
  ).toMatchObject({ authMode: "password", localTenantId: "local" });
});

test("rejects incomplete startup configuration", () => {
  expect(() => loadConfig({})).toThrow("Invalid configuration");
});
