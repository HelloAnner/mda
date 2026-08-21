import { timingSafeEqual } from "node:crypto";
import type { SQL } from "bun";
import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from "jose";
import { HttpError } from "./http.ts";

export interface PrincipalContext {
  tenantId: string;
  userId: string;
  permissions: string[];
}

interface OidcConfig {
  oidcAudience: string;
  oidcIssuer: string;
  oidcJwksUrl: string;
}

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

export async function ensureLocalPrincipal(
  db: SQL,
  tenantId: string,
  userId: string,
): Promise<void> {
  await db.begin(async (transaction) => {
    await transaction`
      INSERT INTO tenants (id, display_name)
      VALUES (${tenantId}, 'Local MDA')
      ON CONFLICT (id) DO NOTHING
    `;
    await transaction`
      INSERT INTO users (
        id, oidc_issuer, oidc_subject, display_name
      ) VALUES (${userId}, 'local-password', ${userId}, 'Local Administrator')
      ON CONFLICT (id) DO NOTHING
    `;
    await transaction`
      INSERT INTO memberships (tenant_id, user_id, permissions)
      VALUES (
        ${tenantId}, ${userId},
        ARRAY['dashboard.create', 'dashboard.read', 'dashboard.edit']
      )
      ON CONFLICT (tenant_id, user_id) DO NOTHING
    `;
  });
}

export function createLocalAuthenticator(
  db: SQL,
  tenantId: string,
  userId: string,
) {
  return async (request: Request): Promise<PrincipalContext> => {
    const requestedTenant = request.headers.get("x-mda-tenant");
    if (requestedTenant && requestedTenant !== tenantId) {
      throw new HttpError(403, "FORBIDDEN", "Access denied");
    }
    const rows = await db`
      SELECT permissions FROM memberships
      WHERE tenant_id = ${tenantId} AND user_id = ${userId} AND status = 'active'
    `;
    const row = rows[0] as { permissions: string[] } | undefined;
    if (!row) throw new HttpError(403, "FORBIDDEN", "Access denied");
    return { tenantId, userId, permissions: row.permissions };
  };
}

export function requirePermission(
  principal: PrincipalContext,
  permission: string,
): void {
  if (!principal.permissions.includes(permission)) {
    throw new HttpError(403, "FORBIDDEN", "Access denied");
  }
}
