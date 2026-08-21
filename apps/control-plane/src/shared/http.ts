import type { ApiError } from "@mda/contracts";

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
