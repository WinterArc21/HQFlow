/**
 * Reads `.codehq/` off disk and turns it into everything an `CodeHQSnapshot` needs
 * EXCEPT the last-valid-state merge, which is `store.ts`'s job (it needs to remember
 * yesterday's valid workflow, and this module only ever sees today's disk).
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { Behavior } from "@schema/behavior";
import type { Issue } from "@schema/diagnostics";
import type { CodeHQProject } from "@schema/project";
import type { RepositoryMap } from "@schema/repository-map";
import { parseBehavior, parseProject, parseRepositoryMap, parseWorkflow } from "@schema/validate";
import type { Workflow } from "@schema/workflow";
import { computeBehaviorSourceChecks, computeWorkflowSourceChecks, type SourceStatus } from "./source-check";
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

export interface LoadedBehavior {
  id: string;
  file: string;
  behavior: Behavior;
  modifiedAt: string;
  sourceChecks: Record<string, SourceStatus>;
}

export type BehaviorFileOutcome =
  | { file: string; status: "valid"; loaded: LoadedBehavior }
  | { file: string; status: "invalid" };

export type RepositoryMapFileOutcome =
  | { file: string; status: "valid"; repositoryMap: RepositoryMap; modifiedAt: string }
  | { file: string; status: "invalid" };

export interface LoadResult {
  status: CodeHQStatus;
  project: CodeHQProject | null;
  repositoryMap: RepositoryMapFileOutcome | null;
  files: WorkflowFileOutcome[];
  behaviors: BehaviorFileOutcome[];
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

async function listJsonFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && !entry.name.startsWith("."))
    .map((entry) => path.join(dir, entry.name))
    .sort();
}

/** Reads and JSON-parses one `.codehq` file, reporting any failure as an error issue. */
async function readJsonFile(
  absoluteFile: string,
  relativeFile: string,
  kind: string,
  issues: Issue[],
): Promise<{ data: unknown; modifiedAt: string } | null> {
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
      message: `Could not read ${kind} file: ${error instanceof Error ? error.message : String(error)}`,
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
  return { data: parsedJson.data, modifiedAt };
}

async function loadWorkflowFile(
  root: string,
  absoluteFile: string,
  relativeFile: string,
  issues: Issue[],
): Promise<WorkflowFileOutcome> {
  const read = await readJsonFile(absoluteFile, relativeFile, "workflow", issues);
  if (read === null) {
    return { file: relativeFile, status: "invalid" };
  }
  const { modifiedAt } = read;

  const result = parseWorkflow(read.data, relativeFile);
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

async function loadBehaviorFile(
  root: string,
  absoluteFile: string,
  relativeFile: string,
  issues: Issue[],
): Promise<BehaviorFileOutcome> {
  const read = await readJsonFile(absoluteFile, relativeFile, "behavior", issues);
  if (read === null) {
    return { file: relativeFile, status: "invalid" };
  }
  const result = parseBehavior(read.data, relativeFile);
  if (!result.ok) {
    issues.push(...result.issues);
    return { file: relativeFile, status: "invalid" };
  }
  issues.push(...result.warnings);

  const { sourceChecks, issues: sourceIssues } = computeBehaviorSourceChecks(root, result.value, relativeFile);
  issues.push(...sourceIssues);

  return {
    file: relativeFile,
    status: "valid",
    loaded: { id: result.value.id, file: relativeFile, behavior: result.value, modifiedAt: read.modifiedAt, sourceChecks },
  };
}

/** Ids are unique per folder, and each should match its file name. */
function checkCrossFileRules(
  kind: "Workflow" | "Behavior",
  loaded: { id: string; file: string },
  absoluteFile: string,
  idToFile: Map<string, string>,
  issues: Issue[],
): boolean {
  const folder = kind === "Workflow" ? "workflows/" : "behaviors/";
  const existingFile = idToFile.get(loaded.id);
  if (existingFile !== undefined) {
    issues.push({
      severity: "error",
      file: loaded.file,
      message: `${kind} id '${loaded.id}' is already used by '${existingFile}'.`,
      hint: `${kind} ids must be unique across every file in ${folder}. Rename this ${kind.toLowerCase()}'s id, or the other file's.`,
    });
    return false;
  }
  idToFile.set(loaded.id, loaded.file);

  const stem = path.basename(absoluteFile, ".json");
  if (stem !== loaded.id) {
    issues.push({
      severity: "warning",
      file: loaded.file,
      path: "id",
      message: `${kind} id '${loaded.id}' does not match its filename stem '${stem}'.`,
      hint: `Rename the file to '${loaded.id}.json', or change 'id' to '${stem}'.`,
    });
  }
  return true;
}

/** Warns about `causedBy` links that point at a workflow or step HQFlow does not have. */
function checkStepLinks(behavior: LoadedBehavior, workflows: ReadonlyArray<WorkflowFileOutcome>, issues: Issue[]): void {
  const stepsByWorkflow = new Map<string, Set<string>>();
  for (const outcome of workflows) {
    if (outcome.status === "valid") {
      stepsByWorkflow.set(outcome.loaded.id, new Set(outcome.loaded.workflow.steps.map((step) => step.id)));
    }
  }
  behavior.behavior.moments.forEach((moment, momentIndex) => {
    (moment.causedBy ?? []).forEach((link, linkIndex) => {
      const steps = stepsByWorkflow.get(link.workflow);
      if (steps !== undefined && steps.has(link.step)) {
        return;
      }
      issues.push({
        severity: "warning",
        file: behavior.file,
        path: `moments[${momentIndex}].causedBy[${linkIndex}]`,
        message: steps === undefined
          ? `Moment '${moment.id}' links to workflow '${link.workflow}', which is not a valid workflow.`
          : `Moment '${moment.id}' links to step '${link.step}', which workflow '${link.workflow}' does not have.`,
        hint: "Point the link at an existing workflow id and step id, or map that workflow first.",
      });
    });
  });
}

/** Loads and validates everything under `.codehq/` for `root`. Never throws. */
export async function loadHQ(root: string): Promise<LoadResult> {
  const paths = codeHQPaths(root);
  const issues: Issue[] = [];

  if (!(await pathExists(paths.dir))) {
    return { status: "uninitialized", project: null, repositoryMap: null, files: [], behaviors: [], issues };
  }

  const project = await loadProject(paths, root, issues);
  const repositoryMap = await loadRepositoryMap(paths, root, issues);
  const workflowFiles = await listJsonFiles(paths.workflowsDir);
  const behaviorFiles = await listJsonFiles(paths.behaviorsDir);

  if (workflowFiles.length === 0 && behaviorFiles.length === 0 && repositoryMap === null) {
    return { status: "empty", project, repositoryMap, files: [], behaviors: [], issues };
  }

  const outcomes: WorkflowFileOutcome[] = [];
  const idToFile = new Map<string, string>();

  for (const absoluteFile of workflowFiles) {
    const relativeFile = toRepoRelativePosix(root, absoluteFile);
    const outcome = await loadWorkflowFile(root, absoluteFile, relativeFile, issues);

    if (outcome.status === "valid" && !checkCrossFileRules("Workflow", outcome.loaded, absoluteFile, idToFile, issues)) {
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

  const behaviors: BehaviorFileOutcome[] = [];
  const behaviorIdToFile = new Map<string, string>();
  for (const absoluteFile of behaviorFiles) {
    const relativeFile = toRepoRelativePosix(root, absoluteFile);
    const outcome = await loadBehaviorFile(root, absoluteFile, relativeFile, issues);
    if (outcome.status === "valid") {
      if (!checkCrossFileRules("Behavior", outcome.loaded, absoluteFile, behaviorIdToFile, issues)) {
        behaviors.push({ file: relativeFile, status: "invalid" });
        continue;
      }
      checkStepLinks(outcome.loaded, outcomes, issues);
    }
    behaviors.push(outcome);
  }

  return { status: "ready", project, repositoryMap, files: outcomes, behaviors, issues };
}
