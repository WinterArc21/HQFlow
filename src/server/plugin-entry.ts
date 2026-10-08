import path from "node:path";
import { fileURLToPath } from "node:url";
import { startPluginStdio } from "./plugin-runtime";

declare const __PLUGIN_VERSION__: string;
const assets = path.dirname(fileURLToPath(import.meta.url));
startPluginStdio(process.env.HQFLOW_ROOT ?? process.cwd(), __PLUGIN_VERSION__, assets).catch((error: unknown) => {
  console.error(`HQFlow plugin: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
