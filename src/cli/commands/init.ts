/**
 * `codehq init` — scaffolds `.codehq/` (contract §9, product brief §C).
 *
 * Returns a plain result object; never calls `process.exit` (see `src/cli/index.ts`).
 */

import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { buildDiagnostics } from "@core/diagnostics";
import { pathExists, toRepoRelativePosix, writeFileAtomic } from "@core/fs-utils";
import { codeHQPaths } from "@core/repository";
import { yellow } from "../output";
import { resolveCliRoot } from "../resolve-root";
import { resolveTemplatesDir } from "../templates";

export interface InitOptions {
  root?: string;
  force?: boolean;
}

type FileAction = "created" | "overwritten" | "unchanged";

interface FileOutcome {
  /** Repository-relative, forward-slash display path. */
  displayPath: string;
  action: FileAction;
}

export interface InitResult {
  exitCode: 0 | 1;
  root: string;
  warnings: string[];
  created: string[];
  unchanged: string[];
}

const GITIGNORE_ENTRY = ".codehq/.runtime/";

function looksLikeProjectRoot(root: string): boolean {
  return existsSync(path.join(root, ".git")) || existsSync(path.join(root, "package.json"));
}

function slugifyProjectId(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  return slug.length > 0 ? slug : "project";
}

function jsonEscape(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

/**
 * Writes `contents` to `targetPath` unless it already exists and `force` is not set, in
 * which case it is skipped and reported "unchanged". This is the single rule that keeps a
 * human-edited `project.json`, `SKILL.md`, or workflow file from ever being clobbered.
 */
async function writeManagedFile(root: string, targetPath: string, contents: string, force: boolean): Promise<FileOutcome> {
  const displayPath = toRepoRelativePosix(root, targetPath);
  const alreadyExists = await pathExists(targetPath);

  if (alreadyExists && !force) {
    return { displayPath, action: "unchanged" };
  }

  await fs.writeFile(targetPath, contents, "utf-8");
  return { displayPath, action: alreadyExists ? "overwritten" : "created" };
}

function normalizeIgnorePattern(line: string): string {
  return line.replace(/^\/+/, "").replace(/\/+$/, "");
}

function gitignoreAlreadyCoversRuntime(content: string): boolean {
  const target = normalizeIgnorePattern(GITIGNORE_ENTRY);
  return content.split(/\r\n|\r|\n/).some((line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      return false;
    }
    const normalized = normalizeIgnorePattern(trimmed);
    return normalized === target || normalized === ".codehq";
  });
}

/**
 * Appends `.codehq/.runtime/` to the repository `.gitignore`, creating it if absent,
 * never duplicating the line (or an equivalent pattern) if already present, and preserving
 * the file's existing newline style when appending to it.
 */
async function ensureGitignoreEntry(root: string): Promise<void> {
  const gitignorePath = path.join(root, ".gitignore");

  if (!(await pathExists(gitignorePath))) {
    await fs.writeFile(gitignorePath, `${GITIGNORE_ENTRY}\n`, "utf-8");
    return;
  }

  const content = await fs.readFile(gitignorePath, "utf-8");
  if (gitignoreAlreadyCoversRuntime(content)) {
    return;
  }

  const usesCrlf = content.includes("\r\n");
  const newline = usesCrlf ? "\r\n" : "\n";
  const base = content.length === 0 || content.endsWith(newline) ? content : `${content}${newline}`;
  await fs.writeFile(gitignorePath, `${base}${GITIGNORE_ENTRY}${newline}`, "utf-8");
}

/** Scaffolds `.codehq/` at the resolved repository root. Never throws; never exits. */
export async function runInit(options: InitOptions): Promise<InitResult> {
  const root = resolveCliRoot(options.root);
  const force = options.force ?? false;

  const warnings: string[] = [];
  if (!looksLikeProjectRoot(root)) {
    warnings.push(`'${root}' has no .git or package.json — this may not be a project root.`);
  }

  const paths = codeHQPaths(root);
  await fs.mkdir(paths.workflowsDir, { recursive: true });

  const templatesDir = resolveTemplatesDir();
  const projectTemplate = await fs.readFile(path.join(templatesDir, "project.json"), "utf-8");
  const skillTemplate = await fs.readFile(path.join(templatesDir, "SKILL.md"), "utf-8");

  const projectName = path.basename(root);
  const projectId = slugifyProjectId(projectName);
  const projectContents = projectTemplate
    .replace(/__PROJECT_ID__/g, jsonEscape(projectId))
    .replace(/__PROJECT_NAME__/g, jsonEscape(projectName));

  const projectOutcome = await writeManagedFile(root, paths.projectFile, projectContents, force);
  const skillOutcome = await writeManagedFile(root, paths.skillFile, skillTemplate, force);

  // .codehq/workflows/ is a directory, not a versioned file: `mkdir recursive` above
  // already made it idempotent, so it is always reported as present under "Created:".
  const workflowsDirOutcome: FileOutcome = { displayPath: `${toRepoRelativePosix(root, paths.workflowsDir)}/`, action: "created" };

  const fixedOutcomes = [projectOutcome, workflowsDirOutcome, skillOutcome];
  const created = fixedOutcomes.filter((o) => o.action !== "unchanged").map((o) => o.displayPath);
  const unchanged = fixedOutcomes.filter((o) => o.action === "unchanged").map((o) => o.displayPath);

  const initialDiagnostics = buildDiagnostics([]);
  await writeFileAtomic(paths.diagnosticsFile, `${JSON.stringify(initialDiagnostics, null, 2)}\n`);

  await ensureGitignoreEntry(root);

  return { exitCode: 0, root, warnings, created, unchanged };
}

/** Renders an `InitResult` in the exact shape specified by the product brief. */
export function printInitResult(result: InitResult): void {
  for (const warning of result.warnings) {
    console.warn(`${yellow("Warning:")} ${warning}`);
  }
  if (result.warnings.length > 0) {
    console.log("");
  }

  console.log("HQFlow initialized.");
  console.log("");
  console.log("Created:");
  for (const line of result.created) {
    console.log(line);
  }

  if (result.unchanged.length > 0) {
    console.log("");
    console.log("Unchanged:");
    for (const line of result.unchanged) {
      console.log(`${line} (exists, left unchanged)`);
    }
  }

  console.log("");
  console.log("Next:");
  console.log("hqflow open");
}
