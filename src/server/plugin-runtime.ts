import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createPluginServer } from "./plugin";
import { resolvePluginRoot } from "./plugin-data";

export async function startPluginStdio(root: string, version: string, assetsDirectory?: string): Promise<void> {
  const assets = assetsDirectory ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "dist", "plugin");
  const [html, authoringGuide] = await Promise.all([
    fs.readFile(path.join(assets, "app.html"), "utf8"),
    fs.readFile(path.join(assets, "authoring-guide.md"), "utf8"),
  ]);
  const server = createPluginServer({ root: await resolvePluginRoot(root), html, authoringGuide, version });
  await server.connect(new StdioServerTransport());
}
