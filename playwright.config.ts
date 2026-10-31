import { defineConfig, devices } from "@playwright/test";
import { ensureBuilt, prepareSharedFixture } from "./tests/e2e/helpers/bootstrap";
import { CLI_ENTRY, REPO_ROOT, SHARED_BASE_URL, SHARED_FIXTURE_DIR, SHARED_PORT } from "./tests/e2e/helpers/paths";

// Runs once, synchronously, at config-load time — before Playwright starts `webServer` below.
// See helpers/bootstrap.ts for why this can't be a `globalSetup` module instead (webServer
// starts ahead of any globalSetup in Playwright's own task pipeline).
//
// `playwright.config.ts` is loaded by the main/orchestrator process AND by every worker
// process it spawns (each worker re-imports the config for its own project settings) — Playwright
// tags worker processes with `TEST_WORKER_INDEX`, which the orchestrator never has at
// config-load time. Without this guard, N workers race the same `rm -rf` + copy of
// SHARED_FIXTURE_DIR concurrently (observed directly: EPIPE / ENOTEMPTY under `fullyParallel`),
// so only the one process that actually owns starting `webServer` may run it.
if (process.env["TEST_WORKER_INDEX"] === undefined) {
  ensureBuilt();
  prepareSharedFixture();
}

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  reporter: "html",
  timeout: 45_000,
  expect: {
    timeout: 7_000,
  },
  use: {
    baseURL: SHARED_BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // The shared, read-only server: boots.spec.ts, a11y-basics.spec.ts, export.spec.ts, and
  // edges-without-measurement.spec.ts all read from this one instance (never write). Every spec that
  // mutates `.codehq/*` spawns and tears down its own dedicated server/port/temp-dir
  // instead (see each spec's `test.beforeAll` and tests/e2e/helpers/paths.ts's `PORTS`) — that
  // is the parallelism-safety split this suite uses, rather than serializing all of `tests/e2e`.
  webServer: {
    command: `node "${CLI_ENTRY}" open --no-open --port ${SHARED_PORT} --root "${SHARED_FIXTURE_DIR}"`,
    url: SHARED_BASE_URL,
    cwd: REPO_ROOT,
    reuseExistingServer: !process.env["CI"],
  },
});
