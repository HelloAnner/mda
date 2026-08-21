import type { ApiError } from "@mda/contracts";
import type { Static, TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export async function readJson<T extends TSchema>(
  request: Request,
  schema: T,
): Promise<Static<T>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, "VALIDATION_ERROR", "Request body must be JSON");
  }
  if (!Value.Check(schema, body)) {
    const errors = [...Value.Errors(schema, body)].map(({ path, message }) => ({
      path,
      message,
    }));
    throw new HttpError(400, "VALIDATION_ERROR", "Invalid request", false, {
      errors,
    });
  }
  return body as Static<T>;
}

export function requireIdempotencyKey(request: Request): string {
  const key = request.headers.get("idempotency-key");
  if (!key || key.trim().length === 0 || key.length > 200) {
    throw new HttpError(
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
      "A valid Idempotency-Key header is required",
    );
  }
  return key;
}

export function errorResponse(
  error: unknown,
  requestId: string = crypto.randomUUID(),
): Response {
  const known = error instanceof HttpError;
  const body: ApiError = {
    code: known ? error.code : "INTERNAL_ERROR",
    message: known ? error.message : "Unexpected server error",
    requestId,
    retryable: known && error.retryable,
    ...(known && error.details ? { details: error.details } : {}),
  };
  return Response.json(body, { status: known ? error.status : 500 });
}
