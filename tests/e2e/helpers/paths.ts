/**
 * Constants shared between `playwright.config.ts` and every spec/helper in `tests/e2e/**` —
 * one source of truth for repo-relative paths, the shared read-only fixture server, and the
 * per-spec ports used by tests that mutate `.codehq/*` and therefore need their own
 * private server + temp directory (see the "port/temp-dir isolation" note in each mutating
 * spec's `test.beforeAll`).
 */
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** `tests/e2e/helpers` -> repository root. */
export const REPO_ROOT = path.resolve(HERE, "..", "..", "..");

/** The committed, read-only fixture repo. No spec, helper, or server invocation may ever
 * point a `--root` at this path directly — always go through a temp copy (see
 * `helpers/fixture.ts`) so `.codehq/diagnostics.json` never gets rewritten here and
 * `git status` stays clean. */
export const SOURCE_FIXTURE_DIR = path.join(REPO_ROOT, "tests", "e2e", "fixtures", "project");

export const CLI_ENTRY = path.join(REPO_ROOT, "dist", "node", "cli.js");
export const WEB_DIST_INDEX = path.join(REPO_ROOT, "dist", "web", "index.html");

/**
 * The shared, read-only server: a fresh copy of the test project, recreated at
 * `playwright.config.ts` module-load time (before Playwright's `webServer` plugin starts the
 * process — see `helpers/bootstrap.ts`), reused across every spec that only ever reads
 * `.codehq` (boots, depth-and-selection, search, a11y-basics).
 */
export const SHARED_FIXTURE_DIR = path.join(os.tmpdir(), "codehq-e2e-shared-fixture");
export const SHARED_PORT = 4399;
export const SHARED_BASE_URL = `http://127.0.0.1:${SHARED_PORT}`;

/**
 * One dedicated port per spec file that spawns its own server against a private temp
 * directory. `playwright.config.ts` runs `fullyParallel`, so distinct ports (and distinct
 * temp dirs, created per-spec via `helpers/fixture.ts`) are what keep concurrent workers from
 * colliding — nothing here is serialized.
 */
export const PORTS = {
  liveUpdate: 4501,
  invalidPreservesBoard: 4502,
  uninitialized: 4503,
  empty: 4504,
  cliOpen: 4505,
  canvasGrammar: 4506,
} as const;
