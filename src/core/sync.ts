/**
 * Optional two-way sync between one repository's `.codehq/` and the signed-in user's cloud
 * account. Each workflow and its canvas layout are compared three ways: the local copy, the
 * cloud copy, and the copy both sides had at the last sync (kept in `.runtime/sync.json`).
 * Only the side that changed is copied. When both sides changed, the local copy wins and the
 * cloud copy is saved to `.runtime/conflicts/<id>.cloud.json`, so no edit is lost.
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SyncedProjectRow, SyncedWorkflowRow } from "@schema/cloud";
import { parseWorkflow } from "@schema/validate";
import type { WorkflowCanvasLayout } from "@schema/wire";
import { currentCloudUser } from "./cloud";
import { pathExists, writeFileAtomic } from "./fs-utils";
import { deleteWorkflowCanvasLayout, readWorkflowCanvasLayout, writeWorkflowCanvasLayout } from "./layout-store";
import { loadHQ, type LoadedWorkflow } from "./load";
import { codeHQPaths } from "./repository";
import type { CodeHQStore } from "./store";

export type SyncDecision = "none" | "push" | "pull" | "conflict";

/** Three-way decision for one item. `null` means the item does not exist on that side. */
export function decideSync(local: string | null, remote: string | null, base: string | null): SyncDecision {
  if (local === remote) {
    return "none";
  }
  if (remote === base) {
    return "push";
  }
  if (local === base) {
    return "pull";
  }
  return "conflict";
}

interface SyncState {
  version: 1;
  ownerId: string;
  projectId: string;
  workflows: Record<string, { workflow: string; layout: string | null }>;
}

export interface SyncReport {
  projectName: string;
  pushed: string[];
  pulled: string[];
  deletedRemote: string[];
  deletedLocal: string[];
  conflicts: string[];
  skipped: string[];
  layoutsPushed: string[];
  layoutsPulled: string[];
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Key-order independent, because Postgres `jsonb` does not keep key order. */
export function contentHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function syncStateFile(root: string): string {
  return path.join(codeHQPaths(root).runtimeDir, "sync.json");
}

async function readSyncState(root: string): Promise<SyncState | null> {
  try {
    return JSON.parse(await fs.readFile(syncStateFile(root), "utf-8")) as SyncState;
  } catch {
    return null;
  }
}

async function writeSyncState(root: string, state: SyncState): Promise<void> {
  const file = syncStateFile(root);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await writeFileAtomic(file, `${JSON.stringify(state, null, 2)}\n`);
}

/** Sync is on for a repository once `hqflow sync` has run there and until `--off`. */
export function isSyncEnabled(root: string): Promise<boolean> {
  return pathExists(syncStateFile(root));
}

export async function disableSync(root: string): Promise<void> {
  await fs.rm(syncStateFile(root), { force: true });
}

function throwOnError(error: { message: string } | null, action: string): void {
  if (error !== null) {
    throw new Error(`Cloud sync could not ${action}: ${error.message}`);
  }
}

/** Runs one sync round for the repository at `root`. Turns sync on if it was off. */
export async function syncProject(root: string, client: SupabaseClient): Promise<SyncReport> {
  const user = await currentCloudUser(client);
  if (user === null) {
    throw new Error("You are not logged in. Run `hqflow login` first.");
  }

  const loaded = await loadHQ(root);
  if (loaded.project === null) {
    throw new Error("Cloud sync needs a valid .codehq/project.json. Run `hqflow init` or `hqflow validate`.");
  }

  let state = await readSyncState(root);
  if (state !== null && state.ownerId !== user.id) {
    throw new Error(
      "This repository syncs to a different HQFlow account. Run `hqflow sync --off`, then sync again to use this account.",
    );
  }

  const { data: projectRow, error: projectError } = await client
    .from("synced_projects")
    .upsert(
      {
        owner_id: user.id,
        project_key: loaded.project.project.id,
        name: loaded.project.project.name,
        project: loaded.project,
      },
      { onConflict: "owner_id,project_key" },
    )
    .select()
    .single<SyncedProjectRow>();
  throwOnError(projectError, "save the project");
  const projectId = projectRow!.id;
  if (state === null || state.projectId !== projectId) {
    state = { version: 1, ownerId: user.id, projectId, workflows: {} };
  }

  const { data: remoteRows, error: remoteError } = await client
    .from("synced_workflows")
    .select("*")
    .eq("project_id", projectId)
    .returns<SyncedWorkflowRow[]>();
  throwOnError(remoteError, "read cloud workflows");

  const paths = codeHQPaths(root);
  const local = new Map<string, LoadedWorkflow>();
  const unreadableIds = new Set<string>();
  for (const outcome of loaded.files) {
    if (outcome.status === "valid") {
      local.set(outcome.loaded.id, outcome.loaded);
    } else {
      unreadableIds.add(path.basename(outcome.file, ".json"));
    }
  }
  const remote = new Map((remoteRows ?? []).map((row) => [row.workflow_id, row]));

  const report: SyncReport = {
    projectName: loaded.project.project.name,
    pushed: [],
    pulled: [],
    deletedRemote: [],
    deletedLocal: [],
    conflicts: [],
    skipped: [],
    layoutsPushed: [],
    layoutsPulled: [],
  };
  const nextBase: SyncState["workflows"] = {};
  const ids = new Set([...local.keys(), ...remote.keys(), ...Object.keys(state.workflows)]);

  for (const id of [...ids].sort()) {
    const localWorkflow = local.get(id);
    const remoteRow = remote.get(id);
    const base = state.workflows[id];

    // An unreadable local file may be an edit in progress. Leave both sides alone.
    if (localWorkflow === undefined && unreadableIds.has(id)) {
      report.skipped.push(id);
      if (base !== undefined) {
        nextBase[id] = base;
      }
      continue;
    }

    const localHash = localWorkflow === undefined ? null : contentHash(localWorkflow.workflow);
    const remoteHash = remoteRow?.workflow_hash ?? null;
    let decision = decideSync(localHash, remoteHash, base?.workflow ?? null);

    if (decision === "conflict") {
      if (localHash === null) {
        // Deleted here but edited elsewhere: keep the edit.
        decision = "pull";
      } else {
        if (remoteRow !== undefined) {
          const conflictFile = path.join(paths.runtimeDir, "conflicts", `${id}.cloud.json`);
          await fs.mkdir(path.dirname(conflictFile), { recursive: true });
          await writeFileAtomic(conflictFile, `${JSON.stringify(remoteRow.workflow, null, 2)}\n`);
        }
        report.conflicts.push(id);
        decision = "push";
      }
    }

    const localFile = localWorkflow !== undefined
      ? path.join(root, localWorkflow.file)
      : path.join(paths.workflowsDir, `${id}.json`);

    if (decision === "pull" && remoteRow !== undefined) {
      const parsed = parseWorkflow(remoteRow.workflow, path.relative(root, localFile));
      if (!parsed.ok || parsed.value.id !== id) {
        report.skipped.push(id);
        if (base !== undefined) {
          nextBase[id] = base;
        }
        continue;
      }
      await fs.mkdir(path.dirname(localFile), { recursive: true });
      await writeFileAtomic(localFile, `${JSON.stringify(parsed.value, null, 2)}\n`);
      report.pulled.push(id);
    } else if (decision === "pull") {
      await fs.rm(localFile, { force: true });
      await deleteWorkflowCanvasLayout(root, id);
      report.deletedLocal.push(id);
      continue;
    } else if (decision === "push" && localWorkflow === undefined) {
      const { error } = await client.from("synced_workflows").delete().eq("project_id", projectId).eq("workflow_id", id);
      throwOnError(error, `delete workflow '${id}'`);
      report.deletedRemote.push(id);
      continue;
    }

    const workflowHash = decision === "pull" ? remoteHash! : localHash;
    if (workflowHash === null) {
      continue;
    }

    const localLayout = await readWorkflowCanvasLayout(root, id);
    const localLayoutHash = localLayout === null ? null : contentHash(localLayout);
    const remoteLayoutHash = remoteRow?.layout_hash ?? null;
    let layoutDecision = decideSync(localLayoutHash, remoteLayoutHash, base?.layout ?? null);
    if (layoutDecision === "conflict") {
      layoutDecision = "push";
    }

    if (layoutDecision === "pull") {
      report.layoutsPulled.push(id);
      if (remoteRow?.layout === null || remoteRow?.layout === undefined) {
        await deleteWorkflowCanvasLayout(root, id);
      } else {
        await writeWorkflowCanvasLayout(root, id, remoteRow.layout);
      }
    }

    const patch: Partial<SyncedWorkflowRow> = {};
    if (decision === "push" && localWorkflow !== undefined) {
      Object.assign(patch, {
        name: localWorkflow.workflow.name,
        workflow: localWorkflow.workflow,
        workflow_hash: localHash,
        source_checks: localWorkflow.sourceChecks,
      });
      report.pushed.push(id);
    }
    if (layoutDecision === "push") {
      report.layoutsPushed.push(id);
      Object.assign(patch, { layout: localLayout as WorkflowCanvasLayout | null, layout_hash: localLayoutHash });
    }

    if (Object.keys(patch).length > 0) {
      const { error } = remoteRow === undefined
        ? await client.from("synced_workflows").insert({ ...patch, project_id: projectId, owner_id: user.id, workflow_id: id })
        : await client.from("synced_workflows").update(patch).eq("project_id", projectId).eq("workflow_id", id);
      throwOnError(error, `save workflow '${id}'`);
    }

    nextBase[id] = {
      workflow: workflowHash,
      layout: layoutDecision === "pull" ? remoteLayoutHash : localLayoutHash,
    };
  }

  await writeSyncState(root, { ...state, workflows: nextBase });
  return report;
}

export function summarizeSyncReport(report: SyncReport): string[] {
  const lines: string[] = [];
  const add = (label: string, ids: string[]): void => {
    if (ids.length > 0) {
      lines.push(`${label}: ${ids.join(", ")}`);
    }
  };
  add("Uploaded", report.pushed);
  add("Downloaded", report.pulled);
  add("Layouts uploaded", report.layoutsPushed);
  add("Layouts downloaded", report.layoutsPulled);
  add("Deleted from cloud", report.deletedRemote);
  add("Deleted locally", report.deletedLocal);
  add("Changed on both sides (kept local, cloud copy in .codehq/.runtime/conflicts/)", report.conflicts);
  add("Skipped (file is invalid or cloud copy failed validation)", report.skipped);
  return lines;
}

/**
 * Keeps a running `hqflow open` in sync: a round after local file changes (debounced) and
 * a round every minute to pick up layout edits and changes from other devices.
 */
export function startAutoSync(
  root: string,
  store: CodeHQStore,
  client: SupabaseClient,
  log: (line: string) => void,
): () => void {
  let running = false;
  let queued = false;
  let debounce: NodeJS.Timeout | undefined;

  const run = async (): Promise<void> => {
    if (running) {
      queued = true;
      return;
    }
    running = true;
    try {
      for (const line of summarizeSyncReport(await syncProject(root, client))) {
        log(`Sync: ${line}`);
      }
    } catch (error) {
      log(`Sync failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      running = false;
      if (queued) {
        queued = false;
        void run();
      }
    }
  };

  const unsubscribe = store.subscribe(() => {
    clearTimeout(debounce);
    debounce = setTimeout(() => void run(), 2000);
  });
  const interval = setInterval(() => void run(), 60_000);
  void run();

  return () => {
    unsubscribe();
    clearTimeout(debounce);
    clearInterval(interval);
  };
}
