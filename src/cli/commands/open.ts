/**
 * `codehq open` — starts the server, opens a browser, and stays alive until the
 * user stops it (contract §9, product brief §D). Unlike `init`/`validate`, this command's
 * returned promise does not resolve until the server is stopped, since "open" is inherently
 * long-running; `index.ts` simply awaits it and exits with the resolved code.
 */

import { spawn } from "node:child_process";
import { pathExists } from "@core/fs-utils";
import { codeHQPaths, repositoryName } from "@core/repository";
import { createCodeHQServer, type CodeHQServer } from "@server/app";
import { resolveCliRoot } from "../resolve-root";

export interface OpenOptions {
  root?: string;
  port?: number;
  open?: boolean;
}

export interface OpenResult {
  exitCode: 0 | 1;
}

const DEFAULT_PORT = 4310;
interface BrowserCommand {
  command: string;
  args: string[];
}

export function buildBrowserOpenCommand(url: string, platform: NodeJS.Platform = process.platform): BrowserCommand {
  switch (platform) {
    case "win32":
      return { command: "explorer.exe", args: [url] };
    case "darwin":
      return { command: "open", args: [url] };
    default:
      return { command: "xdg-open", args: [url] };
  }
}

function openBrowser(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const { command, args } = buildBrowserOpenCommand(url);
    const child = spawn(command, args, { shell: false, stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => {
      // explorer.exe routinely exits non-zero even after successfully opening the URL.
      if (process.platform === "win32" || code === 0 || code === null) {
        resolve();
      } else {
        reject(new Error(`Command '${command}' exited with code ${code}.`));
      }
    });
  });
}

function waitForStopSignal(server: CodeHQServer): Promise<OpenResult> {
  return new Promise((resolve) => {
    let settled = false;
    const shutdown = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
      void server.close().then(() => {
        console.log("Stopped.");
        resolve({ exitCode: 0 });
      });
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}

/** Starts the server and browser, then blocks until SIGINT/SIGTERM stops it cleanly. */
export async function runOpen(options: OpenOptions): Promise<OpenResult> {
  const root = resolveCliRoot(options.root);
  const paths = codeHQPaths(root);
  const shouldOpenBrowser = options.open ?? true;
  const requestedPort = options.port ?? DEFAULT_PORT;

  if (!(await pathExists(paths.dir))) {
    console.warn(`No .codehq/ found at '${root}' — showing the uninitialized state. Run \`hqflow init\` to scaffold it.`);
  }
  let server: CodeHQServer;
  try {
    server = await createCodeHQServer({ root, port: requestedPort, serveWeb: true });
  } catch (error) {
    console.error(`Failed to start HQFlow: ${error instanceof Error ? error.message : String(error)}`);
    return { exitCode: 1 };
  }

  const displayUrl = `http://localhost:${server.port}`;
  const portNote = server.port !== requestedPort ? ` (${requestedPort} was in use)` : "";

  console.log("HQFlow is running.");
  console.log("");
  console.log(`Repository: ${repositoryName(root)}`);
  console.log(`URL: ${displayUrl}${portNote}`);
  console.log("Watching: .codehq/");

  if (shouldOpenBrowser) {
    try {
      await openBrowser(displayUrl);
    } catch (error) {
      console.warn(`Could not open a browser automatically: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return waitForStopSignal(server);
}
