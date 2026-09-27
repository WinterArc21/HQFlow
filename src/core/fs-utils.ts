/**
 * Small, shared filesystem helpers used across `src/core`. Node-only.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

/** True when `target` exists (file or directory). Never throws. */
export async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

/** Converts an absolute path under `root` into a repo-relative, forward-slash path. */
export function toRepoRelativePosix(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join("/");
}

export type JsonParseResult = { ok: true; data: unknown } | { ok: false; message: string };

/** Parses `text` as JSON without throwing; failures carry the parser's own message. */
/** Editors and Windows PowerShell 5.1 often prefix UTF-8 files with a BOM, which `JSON.parse` rejects. */
export function stripByteOrderMark(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function parseJsonText(text: string): JsonParseResult {
  try {
    return { ok: true, data: JSON.parse(stripByteOrderMark(text)) as unknown };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Writes `contents` to `filePath` atomically: writes to a sibling `*.tmp` file in the same
 * directory, then renames it into place. A reader (or a watcher) can never observe a
 * partially written file. Does NOT create missing parent directories — callers that need
 * that should create the directory first.
 */
export async function writeFileAtomic(filePath: string, contents: string): Promise<void> {
  const dir = path.dirname(filePath);
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(tmpPath, contents, "utf-8");
  await fs.rename(tmpPath, filePath);
}
