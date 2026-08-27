import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const schemaAlias = fileURLToPath(new URL("./src/schema", import.meta.url));
const webAlias = fileURLToPath(new URL("./src/web", import.meta.url));

export default defineConfig({
  root: "landing",
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@schema": schemaAlias,
      "@web": webAlias,
    },
  },
  preview: {
    allowedHosts: [".onamp.dev"],
  },
  build: {
    outDir: "../dist/landing",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL("./landing/index.html", import.meta.url)),
        demo: fileURLToPath(new URL("./landing/demo.html", import.meta.url)),
      },
    },
  },
});
