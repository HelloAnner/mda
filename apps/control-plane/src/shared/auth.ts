import { timingSafeEqual } from "node:crypto";
import type { SQL } from "bun";
import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from "jose";
import type { Config } from "../config.ts";
import { HttpError } from "./http.ts";

export interface PrincipalContext {
  tenantId: string;
  userId: string;
  permissions: string[];
}

type OidcConfig = Pick<Config, "oidcAudience" | "oidcIssuer" | "oidcJwksUrl">;

export async function verifyAccessToken(
  token: string,
  config: OidcConfig,
  key: JWTVerifyGetKey,
): Promise<{ issuer: string; subject: string }> {
  try {
    const { payload } = await jwtVerify(token, key, {
      audience: config.oidcAudience,
      issuer: config.oidcIssuer,
    });
    if (!payload.iss || !payload.sub)
      throw new Error("Missing identity claims");
    return { issuer: payload.iss, subject: payload.sub };
  } catch {
    throw new HttpError(401, "UNAUTHENTICATED", "Invalid access token");
  }
}

export function createAuthenticator(
  config: OidcConfig,
  db: SQL,
  key: JWTVerifyGetKey = createRemoteJWKSet(new URL(config.oidcJwksUrl)),
) {
  return async (request: Request): Promise<PrincipalContext> => {
    const authorization = request.headers.get("authorization");
    const tenantId = request.headers.get("x-mda-tenant");
    if (!authorization?.startsWith("Bearer ")) {
      throw new HttpError(401, "UNAUTHENTICATED", "Bearer token required");
    }
    if (!tenantId || tenantId.length > 200) {
      throw new HttpError(
        400,
        "TENANT_REQUIRED",
        "Valid tenant header required",
      );
    }

    const identity = await verifyAccessToken(
      authorization.slice("Bearer ".length),
      config,
      key,
    );
    const rows = await db`
      SELECT u.id AS user_id, m.permissions
      FROM users u
      JOIN memberships m ON m.user_id = u.id
      JOIN tenants t ON t.id = m.tenant_id
      WHERE u.oidc_issuer = ${identity.issuer}
        AND u.oidc_subject = ${identity.subject}
        AND u.status = 'active'
        AND m.tenant_id = ${tenantId}
        AND m.status = 'active'
        AND t.status = 'active'
      LIMIT 1
    `;
    const row = rows[0] as
      | { user_id: string; permissions: string[] }
      | undefined;
    if (!row) throw new HttpError(403, "FORBIDDEN", "Access denied");

    return { tenantId, userId: row.user_id, permissions: row.permissions };
  };
}

function secretMatches(supplied: string, expected: string): boolean {
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  return (
    suppliedBytes.length === expectedBytes.length &&
    timingSafeEqual(suppliedBytes, expectedBytes)
  );
}

export function authorizeGlobalAccess(
  request: Request,
  expectedPassword: string,
): void {
  if (
    !secretMatches(
      request.headers.get("x-mda-access-password") ?? "",
      expectedPassword,
    )
  ) {
    throw new HttpError(
      401,
      "ACCESS_PASSWORD_REQUIRED",
      "Valid deployment access password required",
    );
  }
}

export function authorizeInternalRequest(
  request: Request,
  expectedToken: string,
): void {
  const authorization = request.headers.get("authorization");
  const supplied = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  if (!secretMatches(supplied, expectedToken)) {
    throw new HttpError(401, "UNAUTHENTICATED", "Invalid internal token");
  }
}

export function requirePermission(
  principal: PrincipalContext,
  permission: string,
): void {
  if (!principal.permissions.includes(permission)) {
    throw new HttpError(403, "FORBIDDEN", "Access denied");
  }
}
