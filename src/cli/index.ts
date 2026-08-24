/**
 * `codehq` CLI entry point. Argument wiring only — every command's actual
 * behaviour lives in `src/cli/commands/*.ts` as a plain, testable, non-exiting function.
 * This file is the only place that turns a command result into a process exit code, and the
 * only place that decides how an unhandled error gets printed.
 */

import { Command, InvalidArgumentError } from "commander";
import { printInitResult, runInit } from "./commands/init";
import { runOpen } from "./commands/open";
import { printValidateResult, runValidate } from "./commands/validate";
import { red } from "./output";
import { resolveCliVersion } from "./version";

function isDebugMode(program: Command): boolean {
  return program.opts<{ debug?: boolean }>().debug === true || process.env.HQFLOW_DEBUG === "1";
}

/** Prints a clean one-line error unless debug mode is on, in which case it prints the stack. */
function reportFatalError(error: unknown, debug: boolean): void {
  if (debug) {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error(red(`Error: ${message}`));
}

function parsePort(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new InvalidArgumentError("Port must be an integer between 1 and 65535.");
  }
  return parsed;
}

function buildProgram(): Command {
  const program = new Command();

  program
    .name("hqflow")
    .description("Local-first workflow mapping for coding agents, rendered as an interactive canvas.")
    .version(resolveCliVersion(), "-v, --version", "Print the installed version")
    .option("--debug", "Print full stack traces on error (also HQFLOW_DEBUG=1)");

  program
    .command("init")
    .description("Scaffold .codehq/ in the current repository")
    .option("--force", "Overwrite existing .codehq files")
    .action(async (options: { force?: boolean }) => {
      const result = await runInit({
        ...(options.force !== undefined ? { force: options.force } : {}),
      });
      printInitResult(result);
      process.exitCode = result.exitCode;
    });

  program
    .command("open")
    .description("Start the local server and open the workflow canvas in a browser")
    .option("-p, --port <number>", "Port to listen on (default 4310)", parsePort)
    .option("--root <path>", "Repository root (defaults to autodetection from the current directory)")
    .option("--no-open", "Do not open a browser automatically")
    .action(async (options: { port?: number; root?: string; open?: boolean }) => {
      const result = await runOpen({
        ...(options.port !== undefined ? { port: options.port } : {}),
        ...(options.root !== undefined ? { root: options.root } : {}),
        ...(options.open !== undefined ? { open: options.open } : {}),
      });
      process.exitCode = result.exitCode;
    });

  program
    .command("validate")
    .description("Validate .codehq/ and print diagnostics")
    .option("--root <path>", "Repository root (defaults to autodetection from the current directory)")
    .option("--json", "Print only the DiagnosticsReport as JSON")
    .action(async (options: { root?: string; json?: boolean }) => {
      const result = await runValidate({
        ...(options.root !== undefined ? { root: options.root } : {}),
        ...(options.json !== undefined ? { json: options.json } : {}),
      });
      printValidateResult(result, options.json === true);
      process.exitCode = result.exitCode;
    });

  return program;
}

async function main(): Promise<void> {
  const program = buildProgram();
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    reportFatalError(error, isDebugMode(program));
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  // Should be unreachable (main() already catches command errors), but guarantees no raw
  // stack trace ever reaches the terminal even if something above it is wrong.
  reportFatalError(error, process.env.HQFLOW_DEBUG === "1");
  process.exitCode = 1;
});
