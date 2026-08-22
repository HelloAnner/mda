import { expect, test } from "bun:test";
import { createTarGzip } from "./tar.ts";

test("creates deterministic portable artifact archives", () => {
  const files = [
    {
      path: "assets/app.js",
      bytes: new TextEncoder().encode("console.log('ready');\n"),
      executable: false,
    },
    {
      path: "index.html",
      bytes: new TextEncoder().encode("<!doctype html><main>Ready</main>\n"),
      executable: false,
    },
  ];
  const first = createTarGzip(files);
  const second = createTarGzip(files);
  expect(first).toEqual(second);
  const gzip = Buffer.from(
    first.buffer as ArrayBuffer,
    first.byteOffset,
    first.byteLength,
  );
  const tar = Bun.gunzipSync(gzip);
  const archive = Buffer.from(
    tar.buffer as ArrayBuffer,
    tar.byteOffset,
    tar.byteLength,
  );
  expect(archive.subarray(0, 13).toString()).toBe("assets/app.js");
  expect(archive.includes(Buffer.from("<!doctype html>"))).toBe(true);
});
