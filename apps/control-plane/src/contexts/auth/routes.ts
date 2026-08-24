import {
  LoginRequestSchema,
  RegisterRequestSchema,
  type AuthMeResponse,
} from "@mda/contracts";
import type { SQL } from "bun";
import {
  clearAccountSessionCookie,
  createAccountSession,
  loginAccount,
  registerAccount,
  verifyAccountSession,
  type PrincipalContext,
} from "../../shared/auth.ts";
import { errorResponse, HttpError, readJson } from "../../shared/http.ts";

interface AuthRouteDependencies {
  db: SQL;
  sessionSigningKey?: string;
  authenticate(request: Request): Promise<PrincipalContext>;
}

function jsonWithCookie(body: unknown, cookie: string, status = 200): Response {
  const headers = new Headers({
    "content-type": "application/json",
    "set-cookie": cookie,
  });
  return new Response(JSON.stringify(body), { status, headers });
}

export async function handleAuthRequest(
  request: Request,
  dependencies: AuthRouteDependencies,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/auth")) return undefined;
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

  try {
    if (!dependencies.sessionSigningKey) {
      throw new HttpError(
        503,
        "AUTH_NOT_CONFIGURED",
        "Account authentication is not configured",
      );
    }
    const signingKey = dependencies.sessionSigningKey;
    if (url.pathname === "/api/auth/register" && request.method === "POST") {
      const body = await readJson(request, RegisterRequestSchema);
      const account = await registerAccount(
        dependencies.db,
        body.username,
        body.password,
      );
      const session = await createAccountSession(
        account.userId,
        account.tenantId,
        signingKey,
      );
      return jsonWithCookie(
        { user: { id: account.userId, username: account.username, tenantId: account.tenantId } },
        session.cookie,
        201,
      );
    }

    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      const body = await readJson(request, LoginRequestSchema);
      const account = await loginAccount(
        dependencies.db,
        body.username,
        body.password,
      );
      const session = await createAccountSession(
        account.userId,
        account.tenantId,
        signingKey,
      );
      return jsonWithCookie(
        { user: { id: account.userId, username: account.username, tenantId: account.tenantId } },
        session.cookie,
      );
    }

    if (url.pathname === "/api/auth/logout" && request.method === "POST") {
      return jsonWithCookie({ ok: true }, clearAccountSessionCookie());
    }

    if (url.pathname === "/api/auth/me" && request.method === "GET") {
      const session = await verifyAccountSession(
        request,
        signingKey,
      );
      const rows = await dependencies.db`
        SELECT username FROM users
        WHERE id = ${session.userId} AND status = 'active'
        LIMIT 1
      `;
      const row = rows[0] as { username: string } | undefined;
      if (!row) {
        throw new HttpError(401, "UNAUTHENTICATED", "User no longer exists");
      }
      const response: AuthMeResponse = {
        user: {
          id: session.userId,
          username: row.username,
          tenantId: session.tenantId,
        },
      };
      return Response.json(response);
    }

    throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
