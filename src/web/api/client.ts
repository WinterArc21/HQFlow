import type { CodeHQSnapshot, SourceLookup } from "./types";

/** Base URL is empty: Vite proxies `/api` to the local server (contract §8). */
const BASE_URL = "";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function safeFetch(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${BASE_URL}${path}`, init);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ApiError(0, `Could not reach the HQFlow server: ${detail}`);
  }
}

async function ensureOk(path: string, response: Response): Promise<void> {
  if (response.ok) {
    return;
  }
  const body = await response.text().catch(() => "");
  const message = body.trim().length > 0 ? body.trim() : `Request to ${path} failed with status ${response.status}.`;
  throw new ApiError(response.status, message);
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await safeFetch(path, init);
  await ensureOk(path, response);
  return (await response.json()) as T;
}

export interface WorkflowExportArtifact {
  blob: Blob;
  filename: string;
}

function exportFilename(contentDisposition: string | null, fallback: string): string {
  const encodedMatch = contentDisposition?.match(/filename\*=UTF-8''([^;]+)/i);
  if (encodedMatch?.[1] !== undefined) {
    try {
      return decodeURIComponent(encodedMatch[1]);
    } catch {
      return fallback;
    }
  }

  const plainMatch = contentDisposition?.match(/filename="([^"]+)"|filename=([^;]+)/i);
  return plainMatch?.[1] ?? plainMatch?.[2]?.trim() ?? fallback;
}

/** Fetches a self-contained export artifact with its privacy choice applied. */
export async function fetchWorkflowExport(workflowId: string, hideFilePaths: boolean): Promise<WorkflowExportArtifact> {
  const path = `/api/export/${encodeURIComponent(workflowId)}?hideFilePaths=${String(hideFilePaths)}`;
  const response = await safeFetch(path);
  await ensureOk(path, response);
  return {
    blob: await response.blob(),
    filename: exportFilename(response.headers.get("content-disposition"), "workflow-codehq.html"),
  };
}

/** `GET /api/state` — the primary full snapshot. */
export function getState(): Promise<CodeHQSnapshot> {
  return requestJson<CodeHQSnapshot>("/api/state");
}

/** `GET /api/source` — metadata only, never file contents (contract §8). */
export function getSource(file: string, line?: number): Promise<SourceLookup> {
  const params = new URLSearchParams({ file });
  if (line !== undefined) {
    params.set("line", String(line));
  }
  return requestJson<SourceLookup>(`/api/source?${params.toString()}`);
}

/** `POST /api/recheck` — forces a full reload and returns the new snapshot. */
export function recheck(): Promise<CodeHQSnapshot> {
  return requestJson<CodeHQSnapshot>("/api/recheck", { method: "POST" });
}

/** `DELETE /api/workflows/:id` — removes a verified workflow and returns the refreshed snapshot. */
export function deleteWorkflow(id: string): Promise<CodeHQSnapshot> {
  return requestJson<CodeHQSnapshot>(`/api/workflows/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export type WorkflowLayoutPositions = Record<string, { x: number; y: number }>;

/** `GET /api/workflows/:id/layout` — manually-saved canvas node positions, if any. */
export function getWorkflowLayout(id: string): Promise<{ positions: WorkflowLayoutPositions }> {
  return requestJson<{ positions: WorkflowLayoutPositions }>(`/api/workflows/${encodeURIComponent(id)}/layout`);
}

/** `PUT /api/workflows/:id/layout` — overwrites the saved node positions for this workflow. */
export async function saveWorkflowLayout(id: string, positions: WorkflowLayoutPositions): Promise<void> {
  const path = `/api/workflows/${encodeURIComponent(id)}/layout`;
  const response = await safeFetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(positions),
  });
  await ensureOk(path, response);
}

export interface Folder {
  id: string;
  name: string;
  /** Both membership and manual order: a workflow's folder is whichever folder's array contains it. */
  workflowIds: string[];
}

export interface FolderState {
  folders: Folder[];
}

/** `GET /api/folders` — local, per-clone folder organization of workflows. */
export function getFolders(): Promise<FolderState> {
  return requestJson<FolderState>("/api/folders");
}

/** `POST /api/folders` — creates a new folder. */
export function createFolder(name: string): Promise<Folder> {
  return requestJson<Folder>("/api/folders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

/** `PATCH /api/folders/:id` — renames a folder. */
export function renameFolder(id: string, name: string): Promise<Folder> {
  return requestJson<Folder>(`/api/folders/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

/** `DELETE /api/folders/:id` — deletes a folder; its workflows become unassigned. */
export async function deleteFolder(id: string): Promise<void> {
  const path = `/api/folders/${encodeURIComponent(id)}`;
  const response = await safeFetch(path, { method: "DELETE" });
  await ensureOk(path, response);
}

/** `PUT /api/workflows/:id/folder` — assigns (or, with `null`, unassigns) a workflow's folder. */
export async function assignWorkflowToFolder(id: string, folderId: string | null): Promise<void> {
  const path = `/api/workflows/${encodeURIComponent(id)}/folder`;
  const response = await safeFetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folderId }),
  });
  await ensureOk(path, response);
}

/** `PUT /api/folders/:id/order` — replaces a folder's manual workflow order (a reordering, never an add/remove). */
export function reorderFolder(id: string, workflowIds: string[]): Promise<Folder> {
  return requestJson<Folder>(`/api/folders/${encodeURIComponent(id)}/order`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workflowIds }),
  });
}
