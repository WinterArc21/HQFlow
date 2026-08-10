/**
 * `hqflow validate` — loads and validates `.codehq/`, writes
 * `diagnostics.json`, and reports the result (contract §9, product brief §E).
 */

import type { DiagnosticsReport } from "@schema/diagnostics";
import { buildDiagnostics, writeDiagnostics } from "@core/diagnostics";
import { pathExists } from "@core/fs-utils";
import { loadHQ } from "@core/load";
import { codeHQPaths } from "@core/repository";
import { pluralize, printIssues } from "../output";
import { resolveCliRoot } from "../resolve-root";

export interface ValidateOptions {
  root?: string;
  json?: boolean;
}

export type ValidateResult =
  | { exitCode: 0 | 1; root: string; kind: "missing-codehq"; message: string }
  | { exitCode: 0 | 1; root: string; kind: "report"; report: DiagnosticsReport; workflowCount: number };

/** Loads, validates, and (when `.codehq/` exists) writes `diagnostics.json`. */
export async function runValidate(options: ValidateOptions): Promise<ValidateResult> {
  const root = resolveCliRoot(options.root);
  const paths = codeHQPaths(root);

  if (!(await pathExists(paths.dir))) {
    return {
      exitCode: 1,
      root,
      kind: "missing-codehq",
      message: `No .codehq/ directory found at '${root}'. Run \`hqflow init\` first.`,
    };
  }

  const loaded = await loadHQ(root);
  const report = buildDiagnostics(loaded.issues);
  await writeDiagnostics(root, report);

  return {
    exitCode: report.valid ? 0 : 1,
    root,
    kind: "report",
    report,
    workflowCount: loaded.files.length,
  };
}

/** Renders a `ValidateResult` to stdout/stderr in the requested format. */
export function printValidateResult(result: ValidateResult, json: boolean): void {
  if (result.kind === "missing-codehq") {
    console.error(result.message);
    return;
  }

  if (json) {
    console.log(JSON.stringify(result.report, null, 2));
    return;
  }

  if (result.report.issues.length === 0) {
    if (result.workflowCount === 0) {
      console.log("No workflow files found in .codehq/workflows/.");
      return;
    }
    const noun = result.workflowCount === 1 ? "workflow" : "workflows";
    const verb = result.workflowCount === 1 ? "is" : "are";
    console.log(`All ${result.workflowCount} ${noun} ${verb} valid.`);
    return;
  }

  printIssues(result.report.issues, result.root);

  const errorCount = result.report.issues.filter((issue) => issue.severity === "error").length;
  const warningCount = result.report.issues.length - errorCount;
  console.log(`${pluralize(errorCount, "error")}, ${pluralize(warningCount, "warning")}.`);
}
