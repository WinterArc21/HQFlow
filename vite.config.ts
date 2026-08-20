import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const schemaAlias = fileURLToPath(new URL("./src/schema", import.meta.url));
const webAlias = fileURLToPath(new URL("./src/web", import.meta.url));

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
    outDir: "../../dist/web",
    emptyOutDir: true,
  },
  server: {
    host: true,
    allowedHosts: true,
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:4310",
        ws: false,
        // The web app's own source lives at src/web/api/* (contract §11), which Vite serves
        // under this very same "/api" URL prefix during dev (e.g. `/api/client.ts`). Bypass
        // the proxy for those file requests — recognizable by their extension, unlike any real
        // backend route — so Vite serves them locally instead of forwarding them to a backend
        // that has no matching route and would 404, breaking the whole module graph.
        bypass: (req) => {
          const url = req.url ?? "";
          if (/\.(ts|tsx|js|jsx|css)(\?|$)/.test(url)) {
            return url;
          }
          return undefined;
        },
        // SSE (/api/events) rides plain HTTP: disable response buffering/compression
        // negotiation so chunks reach the client as they are flushed by Fastify.
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.setHeader("accept-encoding", "identity");
          });
        },
      },
    },
  },
});
