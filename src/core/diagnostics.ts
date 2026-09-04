/**
 * Builds diagnostics and persists validation failures to `.codehq/diagnostics.json`.
 */

import { promises as fs } from "node:fs";
import type { DiagnosticsReport, Issue } from "@schema/diagnostics";
import { pathExists, writeFileAtomic } from "./fs-utils";
import { codeHQPaths } from "./repository";

function compareIssues(a: Issue, b: Issue): number {
  if (a.severity !== b.severity) {
    return a.severity === "error" ? -1 : 1;
  }
  if (a.file !== b.file) {
    return a.file < b.file ? -1 : 1;
  }
  const aPath = a.path ?? "";
  const bPath = b.path ?? "";
  if (aPath !== bPath) {
    return aPath < bPath ? -1 : 1;
  }
  return 0;
}

/** Sorts `issues` (errors before warnings, then by file, then by path) and computes `valid`. */
export function buildDiagnostics(issues: Issue[]): DiagnosticsReport {
  const sortedIssues = [...issues].sort(compareIssues);
  return {
    generatedAt: new Date().toISOString(),
    valid: !sortedIssues.some((issue) => issue.severity === "error"),
    issues: sortedIssues,
  };
}

/**
 * Writes failed reports to `.codehq/diagnostics.json`, atomically (write-then-rename)
 * so a watching agent never observes a half-written file. A successful report removes
 * any prior failure file. A no-op when `.codehq/` does not exist (uninitialized repo).
 */
export async function writeDiagnostics(root: string, report: DiagnosticsReport): Promise<void> {
  const paths = codeHQPaths(root);
  if (!(await pathExists(paths.dir))) {
    return;
  }

  if (report.valid) {
    await fs.rm(paths.diagnosticsFile, { force: true });
    return;
  }

  const contents = `${JSON.stringify(report, null, 2)}\n`;
  await writeFileAtomic(paths.diagnosticsFile, contents);
}
