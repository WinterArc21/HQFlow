/**
 * Config-load-time setup for the e2e suite. Both functions here run synchronously from
 * `playwright.config.ts`'s module body, BEFORE `defineConfig()` — not from a `globalSetup`
 * file — because Playwright's own task pipeline starts `webServer` (a plugin's `setup()`)
 * ahead of any `config.globalSetups` entry (see `createGlobalSetupTasks` in
 * `playwright/lib/runner/index.js`: plugin setup tasks are spliced in before the
 * `globalSetups` tasks). A `globalSetup` module would run too late to prepare the directory
 * the shared `webServer` is about to `open --root` against.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import { CLI_ENTRY, REPO_ROOT, SHARED_FIXTURE_DIR, SOURCE_FIXTURE_DIR, WEB_DIST_INDEX } from "./paths";

/**
 * The e2e suite serves the real built app, never source. Builds once if `dist/` is missing
 * or incomplete; leaves an already-built `dist/` alone (delete it, or set
 * `CodeHQ_E2E_FORCE_BUILD=1`, to force a rebuild before the next run).
 */
export function ensureBuilt(): void {
  const alreadyBuilt = fs.existsSync(CLI_ENTRY) && fs.existsSync(WEB_DIST_INDEX);
  if (alreadyBuilt && process.env["CodeHQ_E2E_FORCE_BUILD"] !== "1") {
    return;
  }

  console.log("[e2e] Building the app (dist/node + dist/web) before starting the suite...");
  try {
    execSync("pnpm build", { cwd: REPO_ROOT, stdio: "inherit" });
  } catch (error) {
    throw new Error(
      "[e2e] `pnpm build` failed. The e2e suite serves the real built app (dist/node/cli.js + " +
        `dist/web/) and cannot run without it. Original error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!fs.existsSync(CLI_ENTRY) || !fs.existsSync(WEB_DIST_INDEX)) {
    throw new Error(
      `[e2e] \`pnpm build\` completed but ${CLI_ENTRY} or ${WEB_DIST_INDEX} is still missing. ` +
        "The build output layout may have changed — update tests/e2e/helpers/paths.ts to match.",
    );
  }
}

/**
 * Recreates the shared, read-only fixture directory from the committed test project. Runs on
 * every config load so repeated local runs never accumulate edits from a previous run, and
 * the committed fixture itself is never the directory any server is pointed at.
 */
export function prepareSharedFixture(): void {
  fs.rmSync(SHARED_FIXTURE_DIR, { recursive: true, force: true });
  fs.cpSync(SOURCE_FIXTURE_DIR, SHARED_FIXTURE_DIR, { recursive: true });
}
