import { createHmac, timingSafeEqual } from "node:crypto";

function signature(key: string, previewId: string, expiresAt: string): string {
  return createHmac("sha256", key)
    .update(`${previewId}\n${expiresAt}`)
    .digest("base64url");
}

export function previewPath(
  key: string,
  previewId: string,
  expiresAt: string,
): string {
  const token = signature(key, previewId, expiresAt);
  return `/p/${encodeURIComponent(previewId)}/${encodeURIComponent(token)}/`;
}

export function verifyPreviewToken(
  key: string,
  previewId: string,
  expiresAt: string,
  token: string,
): boolean {
  const expected = Buffer.from(signature(key, previewId, expiresAt));
  const actual = Buffer.from(token);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
