/**
 * Private, disposable temp directories for tests that mutate `.codehq/*`. Never touches
 * the committed test project directly — everything here copies out of it (or
 * creates an empty directory from scratch) into `os.tmpdir()`, so the repo tree stays clean
 * no matter what a test writes.
 */
import { randomBytes } from "node:crypto";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SOURCE_FIXTURE_DIR } from "./paths";

function uniqueDir(label: string): string {
  return path.join(os.tmpdir(), `codehq-e2e-${label}-${randomBytes(4).toString("hex")}`);
}

/** A private copy of the test project, safe for a test to freely rewrite. */
export async function createTempFixtureCopy(label: string): Promise<string> {
  const dir = uniqueDir(label);
  await fsp.cp(SOURCE_FIXTURE_DIR, dir, { recursive: true });
  return dir;
}

/** A brand-new, empty directory (no `.codehq` at all) for uninitialized-state / CLI tests. */
export async function createEmptyTempDir(label: string): Promise<string> {
  const dir = uniqueDir(label);
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

export async function removeTempDir(dir: string): Promise<void> {
  await fsp.rm(dir, { recursive: true, force: true });
}
