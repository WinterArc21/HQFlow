/**
 * `tsx`-runnable dev entry point (`pnpm dev:server`). Starts the API server without the
 * static web build, against `CODEHQ_ROOT` or the current repository by default.
 */

import path from "node:path";
import { resolveRepositoryRoot } from "@core/repository";
import { createCodeHQServer } from "./app";

const PORT = 4310;

async function main(): Promise<void> {
  const envRoot = process.env.CODEHQ_ROOT;
  const startDir = envRoot !== undefined && envRoot.length > 0 ? path.resolve(envRoot) : process.cwd();
  const root = resolveRepositoryRoot(startDir);

  const server = await createCodeHQServer({ root, port: PORT, serveWeb: false, logger: false });

  console.log(`HQFlow dev server running at ${server.url}`);
  console.log(`Watching repository: ${server.root}`);

  const shutdown = (): void => {
    void server.close().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error: unknown) => {
  console.error("Failed to start HQFlow dev server:", error);
  process.exitCode = 1;
});
