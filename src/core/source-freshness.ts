/**
 * Tracks whether the code a workflow points at has changed since the workflow was written.
 *
 * When HQFlow first sees a version of a workflow, it records a content hash of every file that
 * version references (`.codehq/.runtime/source-baselines.json`, local and gitignored). From then
 * on, any referenced file whose hash differs marks the steps that point at it as possibly
 * outdated. A new version of the workflow (the agent re-checked it) or an explicit "mark as up to
 * date" records a fresh baseline. HQFlow never judges whether the change matters — it only
 * reports that the evidence behind a step moved.
 */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ChangedSourceFile, WorkflowFreshness } from "@schema/wire";
import type { Workflow } from "@schema/workflow";
import { writeFileAtomic } from "./fs-utils";
import { codeHQPaths } from "./repository";
import { resolveInsideRepository } from "./safe-path";

const baselineSchema = z.object({
  workflowHash: z.string(),
  recordedAt: z.string(),
  /** Repo-relative POSIX path -> content hash, or `null` when the file was missing at baseline. */
  files: z.record(z.string(), z.string().nullable()),
}).strict();

const baselineFileSchema = z.object({
  version: z.literal(1),
  workflows: z.record(z.string(), baselineSchema),
}).strict();

type BaselineFile = z.infer<typeof baselineFileSchema>;

export interface FreshnessInput {
  id: string;
  workflow: Workflow;
}

const MAX_HASH_CACHE_ENTRIES = 5000;
const hashCache = new Map<string, string>();
const mutationQueues = new Map<string, Promise<unknown>>();

function baselineFilePath(root: string): string {
  return path.join(codeHQPaths(root).runtimeDir, "source-baselines.json");
}

function normalizeFile(file: string): string {
  return file.replace(/\\/g, "/");
}

/** Every file each step points at: its sources, its tests, and its edge cases' sources. */
export function referencedFilesByStep(workflow: Workflow): Map<string, string[]> {
  const byStep = new Map<string, string[]>();
  for (const step of workflow.steps) {
    const files = new Set<string>();
    for (const ref of step.sources ?? []) {
      files.add(normalizeFile(ref.file));
    }
    for (const ref of step.tests ?? []) {
      files.add(normalizeFile(ref.file));
    }
    for (const edgeCase of step.edgeCases ?? []) {
      for (const ref of edgeCase.sources ?? []) {
        files.add(normalizeFile(ref.file));
      }
    }
    if (files.size > 0) {
      byStep.set(step.id, [...files]);
    }
  }
  return byStep;
}

/** Every distinct file a workflow references, for the source watcher. */
export function referencedFiles(workflow: Workflow): string[] {
  return [...new Set([...referencedFilesByStep(workflow).values()].flat())];
}

function workflowHash(workflow: Workflow): string {
  return createHash("sha256").update(JSON.stringify(workflow)).digest("hex");
}

/**
 * Content hash of a referenced file, or `null` when it is missing or outside the repository.
 * Line endings are normalized first so a Windows checkout (CRLF) and a POSIX checkout of the same
 * commit agree. Cached per `(path, mtime, size)`, so an unchanged file is never re-read.
 */
export async function hashSourceFile(root: string, file: string): Promise<string | null> {
  const resolved = resolveInsideRepository(root, file);
  if (!resolved.ok) {
    return null;
  }
  let stats;
  try {
    stats = await fs.stat(resolved.absolutePath);
  } catch {
    return null;
  }
  if (!stats.isFile()) {
    return null;
  }

  const cacheKey = `${resolved.absolutePath}::${stats.mtimeMs}::${stats.size}`;
  const cached = hashCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  let contents: string;
  try {
    contents = await fs.readFile(resolved.absolutePath, "utf-8");
  } catch {
    return null;
  }
  const hash = createHash("sha256").update(contents.replace(/\r\n/g, "\n")).digest("hex");
  if (hashCache.size >= MAX_HASH_CACHE_ENTRIES) {
    const oldestKey = hashCache.keys().next().value;
    if (oldestKey !== undefined) {
      hashCache.delete(oldestKey);
    }
  }
  hashCache.set(cacheKey, hash);
  return hash;
}

async function readBaselineFile(root: string): Promise<BaselineFile> {
  let raw: string;
  try {
    raw = await fs.readFile(baselineFilePath(root), "utf-8");
  } catch {
    return { version: 1, workflows: {} };
  }
  // A corrupt or outdated runtime file is local cache, not user data: start over rather than fail.
  try {
    const parsed = baselineFileSchema.safeParse(JSON.parse(raw) as unknown);
    return parsed.success ? parsed.data : { version: 1, workflows: {} };
  } catch {
    return { version: 1, workflows: {} };
  }
}

/** Serializes read-modify-write cycles on the baseline file so concurrent callers never clobber each other. */
async function mutateBaselineFile<T>(root: string, mutate: (file: BaselineFile) => Promise<{ changed: boolean; result: T }>): Promise<T> {
  const filePath = baselineFilePath(root);
  const previous = mutationQueues.get(filePath) ?? Promise.resolve();
  const operation = previous.catch(() => undefined).then(async () => {
    const file = await readBaselineFile(root);
    const { changed, result } = await mutate(file);
    if (changed) {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await writeFileAtomic(filePath, `${JSON.stringify(file, null, 2)}\n`);
    }
    return result;
  });
  mutationQueues.set(filePath, operation);
  try {
    return await operation;
  } finally {
    if (mutationQueues.get(filePath) === operation) {
      mutationQueues.delete(filePath);
    }
  }
}

async function hashAll(root: string, files: string[]): Promise<Record<string, string | null>> {
  const entries = await Promise.all(files.map(async (file) => [file, await hashSourceFile(root, file)] as const));
  return Object.fromEntries(entries);
}

/**
 * Computes freshness for every workflow, recording a new baseline for any workflow that has none
 * or whose content changed since its baseline. Baselines for workflows no longer present are
 * dropped. Never throws for an unreadable source file — that file simply counts as missing.
 */
export async function computeWorkflowFreshness(root: string, workflows: FreshnessInput[]): Promise<Map<string, WorkflowFreshness>> {
  return mutateBaselineFile(root, async (file) => {
    const results = new Map<string, WorkflowFreshness>();
    let changed = false;

    const presentIds = new Set(workflows.map((input) => input.id));
    for (const id of Object.keys(file.workflows)) {
      if (!presentIds.has(id)) {
        delete file.workflows[id];
        changed = true;
      }
    }

    for (const { id, workflow } of workflows) {
      const byStep = referencedFilesByStep(workflow);
      const current = await hashAll(root, [...new Set([...byStep.values()].flat())]);
      const hash = workflowHash(workflow);
      const baseline = file.workflows[id];

      if (baseline === undefined || baseline.workflowHash !== hash) {
        const recordedAt = new Date().toISOString();
        file.workflows[id] = { workflowHash: hash, recordedAt, files: current };
        changed = true;
        results.set(id, { baselineAt: recordedAt, outdatedSteps: {} });
        continue;
      }

      const outdatedSteps: Record<string, ChangedSourceFile[]> = {};
      for (const [stepId, files] of byStep) {
        const changedFiles: ChangedSourceFile[] = [];
        for (const sourceFile of files) {
          const before = baseline.files[sourceFile];
          const after = current[sourceFile] ?? null;
          // Only files that existed at baseline are tracked: a file that was already missing is
          // the source check's concern, not evidence that moved.
          if (before === undefined || before === null || before === after) {
            continue;
          }
          changedFiles.push({ file: sourceFile, change: after === null ? "deleted" : "modified" });
        }
        if (changedFiles.length > 0) {
          outdatedSteps[stepId] = changedFiles;
        }
      }
      results.set(id, { baselineAt: baseline.recordedAt, outdatedSteps });
    }

    return { changed, result: results };
  });
}

/** Forgets a workflow's baseline, so the next freshness pass records the current code as up to date. */
export async function resetWorkflowBaseline(root: string, workflowId: string): Promise<void> {
  await mutateBaselineFile(root, async (file) => {
    if (!(workflowId in file.workflows)) {
      return { changed: false, result: undefined };
    }
    delete file.workflows[workflowId];
    return { changed: true, result: undefined };
  });
}
