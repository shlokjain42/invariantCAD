import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import {
  BROWSER_SMOKE_CONTENT_SECURITY_POLICY,
} from "./content-security-policy.js";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  preview: {
    headers: {
      "Content-Security-Policy": BROWSER_SMOKE_CONTENT_SECURITY_POLICY,
    },
  },
  build: {
    assetsInlineLimit: 0,
    emptyOutDir: true,
    outDir: fileURLToPath(
      new URL("../../.artifacts/browser-smoke/", import.meta.url),
    ),
  },
});
