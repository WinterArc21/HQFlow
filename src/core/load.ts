/**
 * Reads `.codehq/` off disk and turns it into everything an `CodeHQSnapshot` needs
 * EXCEPT the last-valid-state merge, which is `store.ts`'s job (it needs to remember
 * yesterday's valid workflow, and this module only ever sees today's disk).
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { Issue } from "@schema/diagnostics";
import type { CodeHQProject } from "@schema/project";
import type { RepositoryMap } from "@schema/repository-map";
import { parseProject, parseRepositoryMap, parseWorkflow } from "@schema/validate";
import type { Workflow } from "@schema/workflow";
import { computeWorkflowSourceChecks, type SourceStatus } from "./source-check";
import { parseJsonText, pathExists, toRepoRelativePosix } from "./fs-utils";
import { codeHQPaths, type CodeHQPaths } from "./repository";
import type { CodeHQStatus } from "./types";

export interface LoadedWorkflow {
  id: string;
  file: string;
  workflow: Workflow;
  modifiedAt: string;
  sourceChecks: Record<string, SourceStatus>;
}

export type WorkflowFileOutcome =
  | { file: string; status: "valid"; loaded: LoadedWorkflow }
  | { file: string; status: "invalid" };

export type RepositoryMapFileOutcome =
  | { file: string; status: "valid"; repositoryMap: RepositoryMap; modifiedAt: string }
  | { file: string; status: "invalid" };

export interface LoadResult {
  status: CodeHQStatus;
  project: CodeHQProject | null;
  repositoryMap: RepositoryMapFileOutcome | null;
  files: WorkflowFileOutcome[];
  issues: Issue[];
}

async function loadRepositoryMap(paths: CodeHQPaths, root: string, issues: Issue[]): Promise<RepositoryMapFileOutcome | null> {
  if (!(await pathExists(paths.repositoryMapFile))) {
    return null;
  }
  const relativeFile = toRepoRelativePosix(root, paths.repositoryMapFile);
  try {
    const [text, stats] = await Promise.all([
      fs.readFile(paths.repositoryMapFile, "utf-8"),
      fs.stat(paths.repositoryMapFile),
    ]);
    const parsedJson = parseJsonText(text);
    if (!parsedJson.ok) {
      issues.push({
        severity: "error",
        file: relativeFile,
        message: `Failed to parse JSON: ${parsedJson.message}`,
        hint: "The file may have been saved while an agent was still writing it.",
      });
      return { file: relativeFile, status: "invalid" };
    }
    const result = parseRepositoryMap(parsedJson.data, relativeFile);
    if (!result.ok) {
      issues.push(...result.issues);
      return { file: relativeFile, status: "invalid" };
    }
    issues.push(...result.warnings);
    return { file: relativeFile, status: "valid", repositoryMap: result.value, modifiedAt: stats.mtime.toISOString() };
  } catch (error) {
    issues.push({
      severity: "error",
      file: relativeFile,
      message: `Could not read repository-map.json: ${error instanceof Error ? error.message : String(error)}`,
    });
    return { file: relativeFile, status: "invalid" };
  }
}

async function loadProject(paths: CodeHQPaths, root: string, issues: Issue[]): Promise<CodeHQProject | null> {
  const relativeFile = toRepoRelativePosix(root, paths.projectFile);

  if (!(await pathExists(paths.projectFile))) {
    issues.push({
      severity: "error",
      file: relativeFile,
      message: "Missing .codehq/project.json.",
      hint: "Run `hqflow init`, or create project.json following the documented schema.",
    });
    return null;
  }

  let text: string;
  try {
    text = await fs.readFile(paths.projectFile, "utf-8");
  } catch (error) {
    issues.push({
      severity: "error",
      file: relativeFile,
      message: `Could not read project.json: ${error instanceof Error ? error.message : String(error)}`,
    });
    return null;
  }

  const parsedJson = parseJsonText(text);
  if (!parsedJson.ok) {
    issues.push({
      severity: "error",
      file: relativeFile,
      message: `Failed to parse JSON: ${parsedJson.message}`,
      hint: "The file may have been saved while an agent was still writing it.",
    });
    return null;
  }

  const result = parseProject(parsedJson.data, relativeFile);
  if (!result.ok) {
    issues.push(...result.issues);
    return null;
  }
  return result.value;
}

async function listWorkflowJsonFiles(workflowsDir: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(workflowsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && !entry.name.startsWith("."))
    .map((entry) => path.join(workflowsDir, entry.name))
    .sort();
}

async function loadWorkflowFile(
  root: string,
  absoluteFile: string,
  relativeFile: string,
  issues: Issue[],
): Promise<WorkflowFileOutcome> {
  let text: string;
  let modifiedAt: string;
  try {
    const stats = await fs.stat(absoluteFile);
    modifiedAt = stats.mtime.toISOString();
    text = await fs.readFile(absoluteFile, "utf-8");
  } catch (error) {
    issues.push({
      severity: "error",
      file: relativeFile,
      message: `Could not read workflow file: ${error instanceof Error ? error.message : String(error)}`,
    });
    return { file: relativeFile, status: "invalid" };
  }

  const parsedJson = parseJsonText(text);
  if (!parsedJson.ok) {
    issues.push({
      severity: "error",
      file: relativeFile,
      message: `Failed to parse JSON: ${parsedJson.message}`,
      hint: "The file may have been saved while an agent was still writing it.",
    });
    return { file: relativeFile, status: "invalid" };
  }

  const result = parseWorkflow(parsedJson.data, relativeFile);
  if (!result.ok) {
    issues.push(...result.issues);
    return { file: relativeFile, status: "invalid" };
  }
  issues.push(...result.warnings);

  const { sourceChecks, issues: sourceIssues } = computeWorkflowSourceChecks(root, result.value, relativeFile);
  issues.push(...sourceIssues);

  return {
    file: relativeFile,
    status: "valid",
    loaded: { id: result.value.id, file: relativeFile, workflow: result.value, modifiedAt, sourceChecks },
  };
}

function checkCrossFileRules(
  outcome: Extract<WorkflowFileOutcome, { status: "valid" }>,
  absoluteFile: string,
  idToFile: Map<string, string>,
  issues: Issue[],
): boolean {
  const existingFile = idToFile.get(outcome.loaded.id);
  if (existingFile !== undefined) {
    issues.push({
      severity: "error",
      file: outcome.file,
      message: `Workflow id '${outcome.loaded.id}' is already used by '${existingFile}'.`,
      hint: "Workflow ids must be unique across every file in workflows/. Rename this workflow's id, or the other file's.",
    });
    return false;
  }
  idToFile.set(outcome.loaded.id, outcome.file);

  const stem = path.basename(absoluteFile, ".json");
  if (stem !== outcome.loaded.id) {
    issues.push({
      severity: "warning",
      file: outcome.file,
      path: "id",
      message: `Workflow id '${outcome.loaded.id}' does not match its filename stem '${stem}'.`,
      hint: `Rename the file to '${outcome.loaded.id}.json', or change 'id' to '${stem}'.`,
    });
  }
  return true;
}

/** Loads and validates everything under `.codehq/` for `root`. Never throws. */
export async function loadHQ(root: string): Promise<LoadResult> {
  const paths = codeHQPaths(root);
  const issues: Issue[] = [];

  if (!(await pathExists(paths.dir))) {
    return { status: "uninitialized", project: null, repositoryMap: null, files: [], issues };
  }

  const project = await loadProject(paths, root, issues);
  const repositoryMap = await loadRepositoryMap(paths, root, issues);
  const workflowFiles = await listWorkflowJsonFiles(paths.workflowsDir);

  if (workflowFiles.length === 0 && repositoryMap === null) {
    return { status: "empty", project, repositoryMap, files: [], issues };
  }

  const outcomes: WorkflowFileOutcome[] = [];
  const idToFile = new Map<string, string>();

  for (const absoluteFile of workflowFiles) {
    const relativeFile = toRepoRelativePosix(root, absoluteFile);
    const outcome = await loadWorkflowFile(root, absoluteFile, relativeFile, issues);

    if (outcome.status === "valid" && !checkCrossFileRules(outcome, absoluteFile, idToFile, issues)) {
      outcomes.push({ file: relativeFile, status: "invalid" });
      continue;
    }
    outcomes.push(outcome);
  }

  const defaultWorkflowId = project?.settings?.defaultWorkflowId;
  if (defaultWorkflowId !== undefined && !idToFile.has(defaultWorkflowId)) {
    issues.push({
      severity: "warning",
      file: toRepoRelativePosix(root, paths.projectFile),
      path: "settings.defaultWorkflowId",
      message: `settings.defaultWorkflowId '${defaultWorkflowId}' does not match any known workflow.`,
      hint: "Point defaultWorkflowId at an existing workflow id, or remove it.",
    });
  }

  return { status: "ready", project, repositoryMap, files: outcomes, issues };
}
