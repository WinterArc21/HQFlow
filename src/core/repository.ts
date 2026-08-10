/**
 * Repository root resolution and the canonical `.codehq/*` paths derived from it.
 * Node-only; reused by the server, the store, and (in a later wave) the CLI.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { CodeHQProject } from "@schema/project";

const CODEHQ_DIR_NAME = ".codehq";

function findNearestAncestorWith(startDir: string, markerName: string): string | null {
  let current = startDir;
  let previous: string | null = null;
  while (current !== previous) {
    if (existsSync(path.join(current, markerName))) {
      return current;
    }
    previous = current;
    current = path.dirname(current);
  }
  return null;
}

/**
 * Walks up from `startDir` looking for `.codehq/`, then `.git/`, then `package.json`,
 * each as an independent upward search so `.codehq` always wins even when `.git` sits
 * closer to `startDir`. Falls back to `startDir` itself. Stops at the filesystem root
 * (works for POSIX `/`, Windows drive roots like `C:\`, and UNC-style roots, since
 * `path.dirname` becomes a fixed point there).
 */
export function resolveRepositoryRoot(startDir: string): string {
  const resolvedStart = path.resolve(startDir);
  return (
    findNearestAncestorWith(resolvedStart, CODEHQ_DIR_NAME) ??
    findNearestAncestorWith(resolvedStart, ".git") ??
    findNearestAncestorWith(resolvedStart, "package.json") ??
    resolvedStart
  );
}

interface MinimalProjectFile {
  project?: { name?: unknown };
}

interface MinimalPackageJson {
  name?: unknown;
}

function tryReadJsonName(filePath: string, pick: (data: unknown) => unknown): string | null {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    const name = pick(parsed);
    return typeof name === "string" && name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

/**
 * Best-effort, human-readable repository name: `.codehq/project.json`'s
 * `project.name`, else `package.json`'s `name`, else the root directory's basename.
 * Pass a validated project to avoid reading project.json again. Pass null when validation
 * failed or the file is absent; this explicitly uses the package/directory fallback.
 * With no second argument, malformed or unreadable files also fall through without throwing.
 */
export function repositoryName(root: string, validatedProject?: CodeHQProject | null): string {
  if (validatedProject !== undefined) {
    if (validatedProject !== null) {
      return validatedProject.project.name;
    }
    return repositoryFallbackName(root);
  }

  const paths = codeHQPaths(root);
  const fromProject = tryReadJsonName(paths.projectFile, (data) => (data as MinimalProjectFile).project?.name);
  if (fromProject !== null) {
    return fromProject;
  }

  return repositoryFallbackName(root);
}

/** Package name, then directory basename. Used when project.json is absent or invalid. */
function repositoryFallbackName(root: string): string {
  const fromPackageJson = tryReadJsonName(path.join(root, "package.json"), (data) => (data as MinimalPackageJson).name);
  if (fromPackageJson !== null) {
    return fromPackageJson;
  }

  return path.basename(root);
}

export interface CodeHQPaths {
  dir: string;
  projectFile: string;
  workflowsDir: string;
  diagnosticsFile: string;
  skillFile: string;
  runtimeDir: string;
}

/** Canonical `.codehq/*` paths for a resolved repository `root`. */
export function codeHQPaths(root: string): CodeHQPaths {
  const dir = path.join(root, CODEHQ_DIR_NAME);
  return {
    dir,
    projectFile: path.join(dir, "project.json"),
    workflowsDir: path.join(dir, "workflows"),
    diagnosticsFile: path.join(dir, "diagnostics.json"),
    skillFile: path.join(dir, "SKILL.md"),
    runtimeDir: path.join(dir, ".runtime"),
  };
}
