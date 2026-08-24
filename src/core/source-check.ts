/**
 * Best-effort check of `SourceReference`/`TestReference` pointers against the real
 * repository: does the named file exist? HQFlow does not parse symbols or grade claims.
 */

import { statSync } from "node:fs";
import type { Issue } from "@schema/diagnostics";
import type { SourceStatus } from "@schema/wire";
import type { Workflow } from "@schema/workflow";
import { resolveInsideRepository } from "./safe-path";

export type { SourceStatus } from "@schema/wire";

const MAX_CACHE_ENTRIES = 5000;

const cache = new Map<string, SourceStatus>();

function cacheGet(key: string): SourceStatus | undefined {
  return cache.get(key);
}

function cacheSet(key: string, status: SourceStatus): void {
  if (!cache.has(key) && cache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) {
      cache.delete(oldestKey);
    }
  }
  cache.set(key, status);
}

export interface SourceCheckRef {
  file: string;
  symbol?: string | undefined;
}

/**
 * Checks a single `{ file, symbol? }` reference against the repository on disk.
 * Cached per `(absolutePath, mtimeMs)` so repeated checks across a reload do not
 * re-stat every file. The optional symbol is ignored: it is documentation, not proof.
 */
export function checkSourceReference(root: string, ref: SourceCheckRef): SourceStatus {
  const resolved = resolveInsideRepository(root, ref.file);
  if (!resolved.ok) {
    return "missing";
  }

  let stats;
  try {
    stats = statSync(resolved.absolutePath);
  } catch {
    return "missing";
  }
  if (!stats.isFile()) {
    return "missing";
  }

  const cacheKey = `${resolved.absolutePath}::${stats.mtimeMs}`;
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  cacheSet(cacheKey, "found");
  return "found";
}

function keyFor(ref: SourceCheckRef): string {
  return ref.symbol !== undefined ? `${ref.file}#${ref.symbol}` : ref.file;
}

export interface SourceCheckOutcome {
  sourceChecks: Record<string, SourceStatus>;
  issues: Issue[];
}

/**
 * Computes `sourceChecks` for every source/test reference in a valid `Workflow`
 * (`entryPoint`, each step's `sources`/`tests`/`edgeCases[].sources`), and emits a
 * `warning` Issue — never an `error`, the file may be gitignored or generated — for each
 * occurrence of a `missing` reference, naming the step it came from.
 */
export function computeWorkflowSourceChecks(root: string, workflow: Workflow, file: string): SourceCheckOutcome {
  const sourceChecks: Record<string, SourceStatus> = {};
  const issues: Issue[] = [];

  const record = (ref: SourceCheckRef, context: string, issuePath: string): void => {
    const key = keyFor(ref);
    if (!(key in sourceChecks)) {
      sourceChecks[key] = checkSourceReference(root, ref);
    }
    if (sourceChecks[key] === "missing") {
      issues.push({
        severity: "warning",
        file,
        path: issuePath,
        message: `${context} references '${ref.file}', which does not exist in the repository.`,
        hint: "Update the path, or remove this reference if the file was deleted or is generated.",
      });
    }
  };

  if (workflow.entryPoint !== undefined) {
    record(workflow.entryPoint, "Workflow entryPoint", "entryPoint");
  }

  workflow.steps.forEach((step, stepIndex) => {
    (step.sources ?? []).forEach((ref, refIndex) => {
      record(ref, `Step '${step.id}' source`, `steps[${stepIndex}].sources[${refIndex}]`);
    });
    (step.tests ?? []).forEach((ref, refIndex) => {
      record(ref, `Step '${step.id}' test`, `steps[${stepIndex}].tests[${refIndex}]`);
    });
    (step.edgeCases ?? []).forEach((edgeCase, edgeCaseIndex) => {
      (edgeCase.sources ?? []).forEach((ref, refIndex) => {
        record(
          ref,
          `Step '${step.id}' edge case '${edgeCase.name}' source`,
          `steps[${stepIndex}].edgeCases[${edgeCaseIndex}].sources[${refIndex}]`,
        );
      });
    });
  });

  return { sourceChecks, issues };
}
