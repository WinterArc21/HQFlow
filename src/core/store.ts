/**
 * The live project model. Owns the last-valid-state cache (contract §7.1 — the single most
 * important behaviour in this codebase): when a workflow file goes from valid to invalid,
 * the board keeps showing the last good version, marked `stale`, instead of blanking out.
 */

import type { Issue } from "@schema/diagnostics";
import type { Workflow } from "@schema/workflow";
import type { RepositoryMap } from "@schema/repository-map";
import { buildDiagnostics, writeDiagnostics } from "./diagnostics";
import { loadHQ, type WorkflowFileOutcome } from "./load";
import { codeHQPaths, repositoryName, type CodeHQPaths } from "./repository";
import { toRepoRelativePosix } from "./fs-utils";
import type { CodeHQSnapshot, RepositoryMapRecord, WorkflowRecord } from "./types";
import type { SourceStatus } from "./source-check";
import { computeWorkflowFreshness, referencedFiles, resetWorkflowBaseline } from "./source-freshness";
import { resolveInsideRepository } from "./safe-path";
import { watchHQ, watchSourceFiles, type CodeHQWatcher, type SourceFileWatcher } from "./watcher";

interface CachedWorkflow {
  id: string;
  file: string;
  workflow: Workflow;
  modifiedAt: string;
  sourceChecks: Record<string, SourceStatus>;
  staleSince?: string;
}

interface CachedRepositoryMap {
  file: string;
  repositoryMap: RepositoryMap;
  modifiedAt: string;
  staleSince?: string;
}

export interface CodeHQStore {
  getSnapshot(): CodeHQSnapshot;
  reload(): Promise<CodeHQSnapshot>;
  /** Accepts the current code as what `workflowId` describes, clearing its outdated steps. */
  markSourcesCurrent(workflowId: string): Promise<CodeHQSnapshot>;
  subscribe(listener: (snapshot: CodeHQSnapshot) => void): () => void;
  start(): void;
  stop(): Promise<void>;
}

function buildEmptySnapshot(root: string, paths: CodeHQPaths): CodeHQSnapshot {
  return {
    generatedAt: new Date().toISOString(),
    status: "uninitialized",
    repository: { name: repositoryName(root), root, codeHQDir: paths.dir },
    project: null,
    repositoryMap: null,
    workflows: [],
    diagnostics: { generatedAt: new Date().toISOString(), valid: true, issues: [] },
  };
}

function compareWorkflowRecords(a: WorkflowRecord, b: WorkflowRecord, defaultWorkflowId: string | undefined): number {
  if (defaultWorkflowId !== undefined) {
    if (a.id === defaultWorkflowId && b.id !== defaultWorkflowId) {
      return -1;
    }
    if (b.id === defaultWorkflowId && a.id !== defaultWorkflowId) {
      return 1;
    }
  }
  return a.workflow.name.localeCompare(b.workflow.name);
}

function toStaleRecord(cached: CachedWorkflow, staleSince: string): WorkflowRecord {
  return {
    id: cached.id,
    file: cached.file,
    workflow: cached.workflow,
    modifiedAt: cached.modifiedAt,
    state: "stale",
    staleSince,
    sourceChecks: cached.sourceChecks,
  };
}

function toValidRecord(loaded: Extract<WorkflowFileOutcome, { status: "valid" }>["loaded"]): WorkflowRecord {
  return {
    id: loaded.id,
    file: loaded.file,
    workflow: loaded.workflow,
    modifiedAt: loaded.modifiedAt,
    state: "valid",
    sourceChecks: loaded.sourceChecks,
  };
}

/** Creates a store for the repository at `root`. Call `start()` to begin watching. */
export function createCodeHQStore(root: string): CodeHQStore {
  const paths = codeHQPaths(root);
  const cacheByFile = new Map<string, CachedWorkflow>();
  const listeners = new Set<(snapshot: CodeHQSnapshot) => void>();
  let cachedRepositoryMap: CachedRepositoryMap | null = null;

  let snapshot: CodeHQSnapshot = buildEmptySnapshot(root, paths);
  let watcher: CodeHQWatcher | null = null;
  let sourceWatcher: SourceFileWatcher | null = null;
  let watcherIssue: Issue | null = null;
  // One job at a time, so a freshness pass can never publish records a concurrent reload has
  // already replaced. A queued full reload subsumes a queued freshness pass.
  let jobInFlight: Promise<CodeHQSnapshot> | null = null;
  let queuedJob: "reload" | "freshness" | null = null;

  function notify(): void {
    for (const listener of listeners) {
      listener(snapshot);
    }
  }

  async function withFreshness(records: WorkflowRecord[]): Promise<WorkflowRecord[]> {
    if (records.length === 0) {
      return records;
    }
    let freshness;
    try {
      freshness = await computeWorkflowFreshness(
        root,
        records.map((record) => ({ id: record.id, workflow: record.workflow })),
      );
    } catch (error) {
      // Freshness is advisory: an unwritable runtime directory must never cost the user the board.
      process.stderr.write(`[codehq] could not check source freshness: ${error instanceof Error ? error.message : String(error)}\n`);
      return records;
    }
    return records.map((record) => {
      const result = freshness.get(record.id);
      return result !== undefined ? { ...record, freshness: result } : record;
    });
  }

  function watchReferencedSources(): void {
    if (sourceWatcher === null) {
      return;
    }
    const files = new Set<string>();
    for (const record of snapshot.workflows) {
      for (const file of referencedFiles(record.workflow)) {
        const resolved = resolveInsideRepository(root, file);
        if (resolved.ok) {
          files.add(resolved.absolutePath);
        }
      }
    }
    sourceWatcher.setFiles([...files]);
  }

  function applyOutcome(outcome: WorkflowFileOutcome): WorkflowRecord | null {
    if (outcome.status === "valid") {
      cacheByFile.set(outcome.file, {
        id: outcome.loaded.id,
        file: outcome.loaded.file,
        workflow: outcome.loaded.workflow,
        modifiedAt: outcome.loaded.modifiedAt,
        sourceChecks: outcome.loaded.sourceChecks,
      });
      return toValidRecord(outcome.loaded);
    }

    const cached = cacheByFile.get(outcome.file);
    if (cached === undefined) {
      return null;
    }
    const staleSince = cached.staleSince ?? new Date().toISOString();
    cacheByFile.set(outcome.file, { ...cached, staleSince });
    return toStaleRecord(cached, staleSince);
  }

  async function performReload(): Promise<CodeHQSnapshot> {
    const result = await loadHQ(root);

    let repositoryMap: RepositoryMapRecord | null = null;
    if (result.repositoryMap?.status === "valid") {
      cachedRepositoryMap = {
        file: result.repositoryMap.file,
        repositoryMap: result.repositoryMap.repositoryMap,
        modifiedAt: result.repositoryMap.modifiedAt,
      };
      repositoryMap = { ...cachedRepositoryMap, state: "valid" };
    } else if (result.repositoryMap?.status === "invalid" && cachedRepositoryMap !== null) {
      const staleSince = cachedRepositoryMap.staleSince ?? new Date().toISOString();
      cachedRepositoryMap = { ...cachedRepositoryMap, staleSince };
      repositoryMap = { ...cachedRepositoryMap, state: "stale", staleSince };
    } else if (result.repositoryMap === null) {
      cachedRepositoryMap = null;
    }

    const presentFiles = new Set(result.files.map((outcome) => outcome.file));
    for (const cachedFile of [...cacheByFile.keys()]) {
      if (!presentFiles.has(cachedFile)) {
        cacheByFile.delete(cachedFile);
      }
    }

    const records: WorkflowRecord[] = [];
    for (const outcome of result.files) {
      const record = applyOutcome(outcome);
      if (record !== null) {
        records.push(record);
      }
    }

    const defaultWorkflowId = result.project?.settings?.defaultWorkflowId;
    records.sort((a, b) => compareWorkflowRecords(a, b, defaultWorkflowId));

    const allIssues = watcherIssue !== null ? [...result.issues, watcherIssue] : result.issues;
    const diagnostics = buildDiagnostics(allIssues);
    await writeDiagnostics(root, diagnostics);

    snapshot = {
      generatedAt: new Date().toISOString(),
      status: result.status,
      repository: { name: repositoryName(root, result.project), root, codeHQDir: paths.dir },
      project: result.project,
      repositoryMap,
      workflows: await withFreshness(records),
      diagnostics,
    };

    notify();
    watchReferencedSources();
    return snapshot;
  }

  /** Recomputes only freshness after a source edit; `.codehq` and diagnostics are untouched. */
  async function performFreshnessRefresh(): Promise<CodeHQSnapshot> {
    const workflows = await withFreshness(snapshot.workflows);
    const changed = workflows.some(
      (record, index) => JSON.stringify(record.freshness) !== JSON.stringify(snapshot.workflows[index]?.freshness),
    );
    if (!changed) {
      return snapshot;
    }
    snapshot = { ...snapshot, generatedAt: new Date().toISOString(), workflows };
    notify();
    return snapshot;
  }

  function runGuarded(job: "reload" | "freshness"): Promise<CodeHQSnapshot> {
    if (jobInFlight === null) {
      jobInFlight = (job === "reload" ? performReload() : performFreshnessRefresh()).finally(() => {
        jobInFlight = null;
        const next = queuedJob;
        queuedJob = null;
        if (next !== null) {
          void runGuarded(next);
        }
      });
      return jobInFlight;
    }
    queuedJob = queuedJob === "reload" || job === "reload" ? "reload" : "freshness";
    return jobInFlight;
  }

  function runGuardedReload(): Promise<CodeHQSnapshot> {
    return runGuarded("reload");
  }

  function handleWatcherError(error: Error): void {
    process.stderr.write(`[codehq] file watcher error: ${error.message}\n`);
    watcherIssue = {
      severity: "warning",
      file: toRepoRelativePosix(root, paths.dir),
      message: `The file watcher reported an error: ${error.message}`,
      hint: "Changes to .codehq may not be picked up automatically until HQFlow is restarted.",
    };
    void runGuardedReload();
  }

  return {
    getSnapshot: () => snapshot,
    reload: () => runGuardedReload(),
    markSourcesCurrent: async (workflowId) => {
      await resetWorkflowBaseline(root, workflowId);
      // If a job is already running it may have read the old baseline, so wait for it and then
      // run a pass of our own rather than returning its result.
      if (jobInFlight !== null) {
        await jobInFlight.catch(() => undefined);
      }
      return runGuarded("freshness");
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start: () => {
      if (watcher !== null) {
        return;
      }
      watcher = watchHQ(paths.dir, {
        onChange: () => {
          void runGuardedReload();
        },
        onError: handleWatcherError,
      });
      sourceWatcher = watchSourceFiles({
        onChange: () => {
          void runGuarded("freshness");
        },
        onError: handleWatcherError,
      });
      watchReferencedSources();
    },
    stop: async () => {
      if (watcher !== null) {
        await watcher.close();
        watcher = null;
      }
      if (sourceWatcher !== null) {
        await sourceWatcher.close();
        sourceWatcher = null;
      }
    },
  };
}
