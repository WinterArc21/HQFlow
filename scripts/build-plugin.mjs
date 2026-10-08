import { mkdir, readFile, writeFile, cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build as viteBuild } from "vite";
import { build as bundle } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "dist/plugin");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
await mkdir(output, { recursive: true });
const built = await viteBuild({
  configFile: false,
  plugins: [(await import("@vitejs/plugin-react")).default()],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  resolve: { alias: { "@schema": path.join(root, "src/schema"), "@web": path.join(root, "src/web") } },
  build: { write: false, target: "es2022", cssCodeSplit: false,
    lib: { entry: path.join(root, "src/web/plugin/main.tsx"), name: "HQFlowPlugin", formats: ["iife"] },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
const chunks = (Array.isArray(built) ? built : [built]).flatMap((result) => result.output);
const js = chunks.filter((chunk) => chunk.type === "chunk");
const css = chunks.filter((chunk) => chunk.type === "asset" && chunk.fileName.endsWith(".css"));
if (js.length !== 1) throw new Error("Plugin UI must be a single inline script.");
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HQFlow</title><style>${css.map((asset) => asset.source).join("\n")}</style></head><body><div id="root"></div><script>${js[0].code.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
await writeFile(path.join(output, "app.html"), html);
await cp(path.join(root, "templates/codehq/SKILL.md"), path.join(output, "authoring-guide.md"));
await cp(path.join(root, "LICENSE"), path.join(output, "LICENSE"));
await cp(path.join(root, "node_modules/@openai/mcp-extensions/LICENSE"), path.join(output, "OPENAI-MCP-EXTENSIONS-LICENSE"));
await bundle({
  entryPoints: [path.join(root, "src/server/plugin-entry.ts")], outfile: path.join(output, "server.js"),
  bundle: true, platform: "node", target: "node22", format: "esm", minify: true,
  tsconfig: path.join(root, "tsconfig.node.json"),
  define: { __PLUGIN_VERSION__: JSON.stringify(packageJson.version) },
  banner: { js: 'import { createRequire as __hqCreateRequire } from "node:module"; const require = __hqCreateRequire(import.meta.url);' },
});
// A complete, portable plugin folder; the runtime contains its dependencies.
await cp(path.join(root, "plugins/hqflow"), path.join(root, "dist/hqflow-plugin"), { recursive: true });
await cp(output, path.join(root, "dist/hqflow-plugin/dist"), { recursive: true });
// Repo marketplaces copy this folder into a cache. Include runtime assets before installing.
await cp(output, path.join(root, "plugins/hqflow/dist"), { recursive: true });
