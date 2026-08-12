/**
 * Minimal ANSI terminal rendering for the CLI. No dependency: a handful of escape codes,
 * gated on `NO_COLOR` and TTY-ness, plus the `validate` issue printer.
 *
 * ASCII only — no box-drawing or wide glyphs, so output stays readable in cmd.exe.
 */

import type { Issue } from "@schema/diagnostics";

const ANSI_CODES = {
  reset: "[0m",
  bold: "[1m",
  dim: "[2m",
  red: "[31m",
  yellow: "[33m",
} as const;

/**
 * Colour is disabled when `NO_COLOR` is set (any value, per https://no-color.org) or when
 * stdout is not a TTY (piped output, CI logs, most test runners).
 */
function colorEnabled(): boolean {
  if ("NO_COLOR" in process.env) {
    return false;
  }
  return process.stdout.isTTY === true;
}

function wrap(code: string): (text: string) => string {
  return (text: string) => (colorEnabled() ? `${code}${text}${ANSI_CODES.reset}` : text);
}

export const bold = wrap(ANSI_CODES.bold);
export const dim = wrap(ANSI_CODES.dim);
export const red = wrap(ANSI_CODES.red);
export const yellow = wrap(ANSI_CODES.yellow);

function severityColor(severity: Issue["severity"]): (text: string) => string {
  return severity === "error" ? red : yellow;
}

/** Formats one issue as its main line, plus an aligned dimmed hint line when present. */
function formatIssueLines(issue: Issue): string[] {
  const pathPart = issue.path !== undefined ? `${issue.path}  ` : "";
  const coloredSeverity = severityColor(issue.severity)(issue.severity);
  const lines = [`  ${coloredSeverity}  ${pathPart}${issue.message}`];

  if (issue.hint !== undefined) {
    const hintIndent = " ".repeat(2 + issue.severity.length + 2);
    lines.push(`${hintIndent}${dim(issue.hint)}`);
  }
  return lines;
}

function groupByFile(issues: readonly Issue[]): Map<string, Issue[]> {
  const grouped = new Map<string, Issue[]>();
  for (const issue of issues) {
    const forFile = grouped.get(issue.file) ?? [];
    forFile.push(issue);
    grouped.set(issue.file, forFile);
  }
  return grouped;
}

function sortWithinFile(issues: Issue[]): Issue[] {
  return [...issues].sort((a, b) => {
    if (a.severity !== b.severity) {
      return a.severity === "error" ? -1 : 1;
    }
    const aPath = a.path ?? "";
    const bPath = b.path ?? "";
    return aPath < bPath ? -1 : aPath > bPath ? 1 : 0;
  });
}

/**
 * Prints `issues` grouped by file (files sorted alphabetically, errors before warnings
 * within a file), one blank line between groups. `root` is accepted for interface symmetry
 * with other environments the same report is rendered in; every `Issue.file` is already
 * repository-relative, so nothing here needs to resolve against it.
 */
export function printIssues(issues: readonly Issue[], _root: string): void {
  const grouped = groupByFile(issues);
  const files = [...grouped.keys()].sort();

  for (const file of files) {
    console.log(bold(file));
    const fileIssues = sortWithinFile(grouped.get(file) ?? []);
    for (const issue of fileIssues) {
      for (const line of formatIssueLines(issue)) {
        console.log(line);
      }
    }
    console.log("");
  }
}

/** `1 error` / `2 errors`, `0 warnings` / `1 warning`, etc. */
export function pluralize(count: number, singular: string, plural: string = `${singular}s`): string {
  return count === 1 ? `${count} ${singular}` : `${count} ${plural}`;
}
