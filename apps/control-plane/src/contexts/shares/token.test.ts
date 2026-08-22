import { expect, test } from "bun:test";
import { sharePath, shareToken, shareTokenDigest } from "./token.ts";

test("derives stable opaque Share tokens while persisting only their digest", () => {
  const key = "share-signing-key-at-least-32-bytes";
  const first = shareToken(key, "share_1");
  expect(first).toBe(shareToken(key, "share_1"));
  expect(first).not.toBe(shareToken(key, "share_2"));
  expect(first).not.toContain("share_1");
  expect(shareTokenDigest(first)).toMatch(/^[a-f0-9]{64}$/);
  expect(sharePath(first)).toBe(`/s/${first}/`);
});
