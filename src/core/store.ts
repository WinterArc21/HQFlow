/**
 * The live project model. Owns the last-valid-state cache (contract §7.1 — the single most
 * important behaviour in this codebase): when a workflow file goes from valid to invalid,
 * the board keeps showing the last good version, marked `stale`, instead of blanking out.
 */

import type { Issue } from "@schema/diagnostics";
import type { Workflow } from "@schema/workflow";
import { buildDiagnostics, writeDiagnostics } from "./diagnostics";
import { loadHQ, type WorkflowFileOutcome } from "./load";
import { codeHQPaths, repositoryName, type CodeHQPaths } from "./repository";
import { toRepoRelativePosix } from "./fs-utils";
import type { CodeHQSnapshot, WorkflowRecord } from "./types";
import type { SourceStatus } from "./source-check";
import { watchHQ, type CodeHQWatcher } from "./watcher";

interface CachedWorkflow {
  id: string;
  file: string;
  workflow: Workflow;
  modifiedAt: string;
  sourceChecks: Record<string, SourceStatus>;
  staleSince?: string;
}

export interface CodeHQStore {
  getSnapshot(): CodeHQSnapshot;
  reload(): Promise<CodeHQSnapshot>;
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

  let snapshot: CodeHQSnapshot = buildEmptySnapshot(root, paths);
  let watcher: CodeHQWatcher | null = null;
  let watcherIssue: Issue | null = null;
  let reloadInFlight: Promise<CodeHQSnapshot> | null = null;
  let reloadQueued = false;

  function notify(): void {
    for (const listener of listeners) {
      listener(snapshot);
    }
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
      workflows: records,
      diagnostics,
    };

    notify();
    return snapshot;
  }

  function runGuardedReload(): Promise<CodeHQSnapshot> {
    if (reloadInFlight === null) {
      reloadInFlight = performReload().finally(() => {
        reloadInFlight = null;
        if (reloadQueued) {
          reloadQueued = false;
          void runGuardedReload();
        }
      });
      return reloadInFlight;
    }
    reloadQueued = true;
    return reloadInFlight;
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
    },
    stop: async () => {
      if (watcher !== null) {
        await watcher.close();
        watcher = null;
      }
    },
  };
}
