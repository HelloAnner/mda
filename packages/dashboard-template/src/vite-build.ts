import react from "@vitejs/plugin-react";
import { build } from "vite";

const root = process.argv[2];
if (!root) throw new Error("Dashboard build root is required");

await build({
  root,
  base: "./",
  configFile: false,
  publicDir: "public",
  plugins: [react()],
  resolve: {
    dedupe: ["react", "react-dom"],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    assetsInlineLimit: 4_096,
    cssCodeSplit: true,
    sourcemap: false,
    target: "es2022",
    reportCompressedSize: false,
  },
  clearScreen: false,
  logLevel: "info",
});
