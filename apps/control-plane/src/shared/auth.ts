import { timingSafeEqual } from "node:crypto";
import type { SQL } from "bun";
import {
  createRemoteJWKSet,
  type JWTVerifyGetKey,
  jwtVerify,
  SignJWT,
} from "jose";
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
        ARRAY[
          'dashboard.create', 'dashboard.read', 'dashboard.edit',
          'data-source.list', 'data-source.read', 'data-source.create',
          'data-source.update', 'data-source.test', 'query.create',
          'query.execute'
        ]
      )
      ON CONFLICT (tenant_id, user_id) DO UPDATE
      SET permissions = EXCLUDED.permissions, status = 'active', updated_at = now()
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

const SESSION_COOKIE_NAME = "mda_session";
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export interface AccountAuthDependencies {
  db: SQL;
  sessionSigningKey: string;
}

function sessionKeyBytes(key: string): Uint8Array {
  return new TextEncoder().encode(key);
}

export async function createAccountSession(
  userId: string,
  tenantId: string,
  signingKey: string,
): Promise<{ token: string; cookie: string }> {
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ userId, tenantId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + SESSION_MAX_AGE_SECONDS)
    .sign(sessionKeyBytes(signingKey));
  const cookie = `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
  return { token, cookie };
}

export function clearAccountSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export async function verifyAccountSession(
  request: Request,
  signingKey: string,
): Promise<{ userId: string; tenantId: string }> {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(
    new RegExp(`(?:^|;)\\s*${SESSION_COOKIE_NAME}=([^;]+)`),
  );
  const token = match?.[1];
  if (!token) {
    throw new HttpError(401, "UNAUTHENTICATED", "Session required");
  }
  try {
    const { payload } = await jwtVerify(
      token,
      sessionKeyBytes(signingKey),
      { algorithms: ["HS256"] },
    );
    const userId = payload.userId;
    const tenantId = payload.tenantId;
    if (typeof userId !== "string" || typeof tenantId !== "string") {
      throw new Error("Invalid session payload");
    }
    return { userId, tenantId };
  } catch {
    throw new HttpError(401, "UNAUTHENTICATED", "Invalid or expired session");
  }
}

export async function registerAccount(
  db: SQL,
  username: string,
  password: string,
): Promise<{ userId: string; tenantId: string; username: string }> {
  const normalized = username.trim();
  if (!normalized || normalized.length > 200) {
    throw new HttpError(400, "VALIDATION_ERROR", "Invalid username");
  }
  if (!password) {
    throw new HttpError(400, "VALIDATION_ERROR", "Password is required");
  }
  const passwordHash = await Bun.password.hash(password, {
    algorithm: "bcrypt",
  });
  const userId = crypto.randomUUID();
  const tenantId = crypto.randomUUID();
  try {
    await db.begin(async (tx) => {
      await tx`
        INSERT INTO tenants (id, display_name)
        VALUES (${tenantId}, ${normalized})
      `;
      await tx`
        INSERT INTO users (id, username, password_hash, display_name)
        VALUES (${userId}, ${normalized}, ${passwordHash}, ${normalized})
      `;
      await tx`
        INSERT INTO memberships (tenant_id, user_id, permissions)
        VALUES (
          ${tenantId}, ${userId},
          ARRAY[
            'dashboard.create', 'dashboard.read', 'dashboard.edit',
            'data-source.list', 'data-source.read', 'data-source.create',
            'data-source.update', 'data-source.test', 'query.create',
            'query.execute'
          ]
        )
      `;
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("unique") || message.toLowerCase().includes("duplicate")) {
      throw new HttpError(409, "USERNAME_TAKEN", "Username already exists");
    }
    throw error;
  }
  return { userId, tenantId, username: normalized };
}

export async function loginAccount(
  db: SQL,
  username: string,
  password: string,
): Promise<{ userId: string; tenantId: string; username: string }> {
  const normalized = username.trim();
  const rows = await db`
    SELECT u.id AS user_id, u.password_hash, u.username, m.tenant_id
    FROM users u
    JOIN memberships m ON m.user_id = u.id
    WHERE u.username = ${normalized}
      AND u.status = 'active'
      AND m.status = 'active'
    LIMIT 1
  `;
  const row = rows[0] as
    | {
        user_id: string;
        password_hash: string;
        username: string;
        tenant_id: string;
      }
    | undefined;
  if (!row) {
    throw new HttpError(
      401,
      "INVALID_CREDENTIALS",
      "Invalid username or password",
    );
  }
  const ok = await Bun.password.verify(password, row.password_hash);
  if (!ok) {
    throw new HttpError(
      401,
      "INVALID_CREDENTIALS",
      "Invalid username or password",
    );
  }
  return { userId: row.user_id, tenantId: row.tenant_id, username: row.username };
}

export function createAccountAuthenticator(
  dependencies: AccountAuthDependencies,
) {
  return async (request: Request): Promise<PrincipalContext> => {
    const { userId, tenantId } = await verifyAccountSession(
      request,
      dependencies.sessionSigningKey,
    );
    const rows = await dependencies.db`
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
