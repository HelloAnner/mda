import type { SQL } from "bun";
import { HttpError } from "./http.ts";

export function requestDigest(value: unknown): string {
  return new Bun.CryptoHasher("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

export async function claimIdempotency(
  transaction: SQL,
  input: {
    tenantId: string;
    operation: string;
    key: string;
    requestDigest: string;
    resultId: string;
  },
): Promise<string | undefined> {
  const claimed = await transaction`
    INSERT INTO control_idempotency_keys (
      tenant_id, operation, key, request_digest, result_id
    ) VALUES (
      ${input.tenantId}, ${input.operation}, ${input.key},
      ${input.requestDigest}, ${input.resultId}
    )
    ON CONFLICT DO NOTHING
    RETURNING result_id
  `;
  if (claimed.length > 0) return undefined;

  const existing = await transaction`
    SELECT request_digest, result_id
    FROM control_idempotency_keys
    WHERE tenant_id = ${input.tenantId}
      AND operation = ${input.operation}
      AND key = ${input.key}
  `;
  const row = existing[0] as
    | { request_digest: string; result_id: string }
    | undefined;
  if (!row || row.request_digest !== input.requestDigest) {
    throw new HttpError(
      409,
      "IDEMPOTENCY_CONFLICT",
      "Idempotency key was already used for another request",
    );
  }
  return row.result_id;
}
