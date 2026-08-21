import { expect, test } from "bun:test";
import { loadConfig } from "./config.ts";

const valid = {
  DATABASE_URL: "postgres://mda:test@localhost/mda",
  OIDC_ISSUER: "https://identity.example",
  OIDC_AUDIENCE: "mda",
  OIDC_JWKS_URL: "https://identity.example/.well-known/jwks.json",
};

test("loads and converts startup configuration", () => {
  expect(loadConfig({ ...valid, PORT: "9090" })).toEqual({
    hostname: "0.0.0.0",
    port: 9090,
    databaseUrl: valid.DATABASE_URL,
    oidcIssuer: valid.OIDC_ISSUER,
    oidcAudience: valid.OIDC_AUDIENCE,
    oidcJwksUrl: valid.OIDC_JWKS_URL,
  });
});

test("rejects incomplete startup configuration", () => {
  expect(() => loadConfig({})).toThrow("Invalid configuration");
});
