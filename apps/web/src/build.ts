import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const outdir = resolve(root, "dist");
const assets = resolve(outdir, "assets");

await rm(outdir, { recursive: true, force: true });
await mkdir(assets, { recursive: true });

const result = await Bun.build({
  entrypoints: [resolve(root, "src/main.tsx")],
  outdir: assets,
  target: "browser",
  minify: true,
  sourcemap: "none",
  define: { "process.env.NODE_ENV": '"production"' },
  naming: "[name]-[hash].[ext]",
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  throw new Error("MDA web build failed");
}

await cp(resolve(root, "public"), outdir, { recursive: true });
const script = result.outputs.find((output) => output.path.endsWith(".js"));
const stylesheet = result.outputs.find((output) =>
  output.path.endsWith(".css"),
);
if (!script || !stylesheet) {
  throw new Error("MDA web build did not produce JavaScript and CSS");
}

await writeFile(
  resolve(outdir, "index.html"),
  `<!doctype html>
<html lang="zh-CN" data-theme="light">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light dark" />
    <meta name="theme-color" content="#FAF9F7" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="stylesheet" href="/fonts/google-fonts.css" />
    <link rel="stylesheet" href="/assets/${basename(stylesheet.path)}" />
    <title>MDA · 智能看板工作台</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/assets/${basename(script.path)}"></script>
  </body>
</html>
`,
);

console.log(
  JSON.stringify({
    event: "web.built",
    outputs: result.outputs.map((output) => basename(output.path)),
  }),
);
