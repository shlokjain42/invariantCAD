import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  build: {
    assetsInlineLimit: 0,
    emptyOutDir: true,
    outDir: fileURLToPath(
      new URL("../../.artifacts/browser-smoke/", import.meta.url),
    ),
  },
});
