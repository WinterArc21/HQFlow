/**
 * Separate Vite build for the export viewer: produces a single IIFE JavaScript bundle and a
 * single CSS file (no code splitting, no external assets) that the server inlines into the
 * exported HTML template. IIFE (not ES module) so the file works when opened from `file://`
 * without a dev server origin.
 */
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const schemaAlias = fileURLToPath(new URL("./src/schema", import.meta.url));
const webAlias = fileURLToPath(new URL("./src/web", import.meta.url));
const entryPath = fileURLToPath(new URL("./src/web/export-viewer/main.tsx", import.meta.url));

export default defineConfig({
  root: "src/web",
  plugins: [react()],
  resolve: {
    alias: {
      "@schema": schemaAlias,
      "@web": webAlias,
    },
  },
  build: {
    outDir: "../../dist/export-viewer",
    emptyOutDir: true,
    // Keep the optional canvas photo inside the single-file export. The current prototype image
    // is intentionally below this ceiling, so exported snapshots remain portable from file://.
    assetsInlineLimit: 200_000,
    cssCodeSplit: false,
    rollupOptions: {
      input: entryPath,
      output: {
        format: "iife",
        inlineDynamicImports: true,
        entryFileNames: "export-viewer.js",
        assetFileNames: "export-viewer[extname]",
      },
    },
  },
});
