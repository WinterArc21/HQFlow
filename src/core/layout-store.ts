/**
 * Persists manually-arranged canvas node positions per workflow, keyed by step id. 
 * Stored at `.codehq/.runtime/layout.json`
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { codeHQPaths } from "./repository";

export interface LayoutPosition {
  x: number;
  y: number;
}

export type WorkflowLayoutPositions = Record<string, LayoutPosition>;
type LayoutFile = Record<string, WorkflowLayoutPositions>;

function layoutFilePath(root: string): string {
  return path.join(codeHQPaths(root).runtimeDir, "layout.json");
}

async function readLayoutFile(root: string): Promise<LayoutFile> {
  try {
    const raw = await readFile(layoutFilePath(root), "utf-8");
    return JSON.parse(raw) as LayoutFile;
  } catch {
    return {};
  }
}

/** Saved node positions for one workflow, or `null` if nothing has been saved for it yet. */
export async function readWorkflowLayout(root: string, workflowId: string): Promise<WorkflowLayoutPositions | null> {
  const file = await readLayoutFile(root);
  return file[workflowId] ?? null;
}

/** Overwrites the saved positions for one workflow, leaving every other workflow's entry untouched. */
export async function writeWorkflowLayout(root: string, workflowId: string, positions: WorkflowLayoutPositions): Promise<void> {
  const file = await readLayoutFile(root);
  file[workflowId] = positions;
  const filePath = layoutFilePath(root);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(file, null, 2));
}
