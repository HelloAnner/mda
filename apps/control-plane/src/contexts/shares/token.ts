import { createHash, createHmac } from "node:crypto";

export function shareToken(signingKey: string, shareLinkId: string): string {
  return createHmac("sha256", signingKey)
    .update(`mda-share-link\n${shareLinkId}`)
    .digest("base64url");
}

export function shareTokenDigest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function sharePath(token: string): string {
  return `/s/${encodeURIComponent(token)}/`;
}
