import { expect, test } from "bun:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { authorizeGlobalAccess, verifyAccessToken } from "./auth.ts";

const config = {
  oidcIssuer: "https://identity.example",
  oidcAudience: "mda",
  oidcJwksUrl: "https://identity.example/jwks.json",
};

test("requires the deployment access password", () => {
  const request = new Request("http://localhost/api/dashboards", {
    headers: { "x-mda-access-password": "global-password" },
  });
  expect(() => authorizeGlobalAccess(request, "global-password")).not.toThrow();
  expect(() =>
    authorizeGlobalAccess(new Request(request.url), "global-password"),
  ).toThrow("access password");
});

test("accepts only correctly issued and scoped access tokens", async () => {
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const key = { ...(await exportJWK(publicKey)), kid: "test", alg: "ES256" };
  const verifier = createLocalJWKSet({ keys: [key] });
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: "test" })
    .setIssuer(config.oidcIssuer)
    .setAudience(config.oidcAudience)
    .setSubject("user-1")
    .setExpirationTime("5m")
    .sign(privateKey);

  await expect(verifyAccessToken(token, config, verifier)).resolves.toEqual({
    issuer: config.oidcIssuer,
    subject: "user-1",
  });
  await expect(
    verifyAccessToken(token, { ...config, oidcAudience: "other" }, verifier),
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
});
