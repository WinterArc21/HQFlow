/**
 * Persists local, per-clone Folder organization of workflows.
 * Stored at `.codehq/.runtime/folders.json`.
 *
 * A folder's `workflowIds` is both its membership and its manual order — a workflow's folder
 * is whichever folder's array contains it, so membership and order can never drift apart.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { codeHQPaths } from "./repository";

export interface Folder {
  id: string;
  name: string;
  workflowIds: string[];
}

export interface FolderState {
  folders: Folder[];
}

function folderFilePath(root: string): string {
  return path.join(codeHQPaths(root).runtimeDir, "folders.json");
}

export async function readFolders(root: string): Promise<FolderState> {
  try {
    const raw = await readFile(folderFilePath(root), "utf-8");
    return JSON.parse(raw) as FolderState;
  } catch {
    return { folders: [] };
  }
}

async function writeFolderState(root: string, state: FolderState): Promise<void> {
  const filePath = folderFilePath(root);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(state, null, 2));
}

export async function createFolder(root: string, name: string): Promise<Folder> {
  const state = await readFolders(root);
  const folder: Folder = { id: randomUUID(), name, workflowIds: [] };
  state.folders.push(folder);
  await writeFolderState(root, state);
  return folder;
}

export async function renameFolder(root: string, folderId: string, name: string): Promise<Folder> {
  const state = await readFolders(root);
  const folder = state.folders.find((candidate) => candidate.id === folderId);
  if (folder === undefined) {
    throw new Error(`No folder with id '${folderId}'.`);
  }
  folder.name = name;
  await writeFolderState(root, state);
  return folder;
}

/** Assigns a workflow to `folderId` (appended at the end), removing it from any other folder it was in. `null` unassigns it entirely. */
export async function assignWorkflowToFolder(root: string, workflowId: string, folderId: string | null): Promise<void> {
  const state = await readFolders(root);
  for (const folder of state.folders) {
    folder.workflowIds = folder.workflowIds.filter((id) => id !== workflowId);
  }
  if (folderId !== null) {
    const folder = state.folders.find((candidate) => candidate.id === folderId);
    if (folder === undefined) {
      throw new Error(`No folder with id '${folderId}'.`);
    }
    folder.workflowIds.push(workflowId);
  }
  await writeFolderState(root, state);
}

export async function deleteFolder(root: string, folderId: string): Promise<void> {
  const state = await readFolders(root);
  state.folders = state.folders.filter((folder) => folder.id !== folderId);
  await writeFolderState(root, state);
}

/** Replaces a folder's manual order. `workflowIds` must be exactly the folder's current members, reordered — no additions or removals. */
export async function reorderFolderWorkflows(root: string, folderId: string, workflowIds: string[]): Promise<Folder> {
  const state = await readFolders(root);
  const folder = state.folders.find((candidate) => candidate.id === folderId);
  if (folder === undefined) {
    throw new Error(`No folder with id '${folderId}'.`);
  }
  const currentSet = new Set(folder.workflowIds);
  const nextSet = new Set(workflowIds);
  const sameMembers = currentSet.size === nextSet.size && [...currentSet].every((id) => nextSet.has(id));
  if (!sameMembers) {
    throw new Error(`New order for folder '${folderId}' must contain exactly its current members.`);
  }
  folder.workflowIds = workflowIds;
  await writeFolderState(root, state);
  return folder;
}
