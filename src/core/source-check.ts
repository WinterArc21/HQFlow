/**
 * Best-effort verification of `SourceReference`/`TestReference` pointers against the real
 * repository: does the file exist, and (best-effort, text-regex only — no parser) does the
 * named symbol actually appear as a declaration rather than merely as a comment or a
 * substring of another identifier.
 */

import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { Issue } from "@schema/diagnostics";
import type { SourceStatus } from "@schema/wire";
import type { Workflow } from "@schema/workflow";
import { resolveInsideRepository } from "./safe-path";

export type { SourceStatus } from "@schema/wire";

const MAX_FILE_SIZE_BYTES = 1.5 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 5000;

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"]);

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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Strips `//` line comments and `/* *\/` block comments before symbol matching, so a symbol
 * name that only appears in prose does not count as "verified". Deliberately naive (no
 * string-literal awareness) except for the one very common false-positive it would
 * otherwise create: a `://` inside a URL string is not treated as a line comment.
 */
function stripComments(source: string): string {
  const withoutBlockComments = source.replace(/\/\*[\s\S]*?\*\//g, (match) => " ".repeat(match.length));
  return withoutBlockComments.replace(/(?<!:)\/\/[^\n]*/g, (match) => " ".repeat(match.length));
}

function buildSymbolPatterns(symbol: string): RegExp[] {
  const s = escapeRegExp(symbol);
  return [
    // function declaration, generator, or async function: `function foo(`, `function* foo(`
    new RegExp(`\\bfunction\\s*\\*?\\s*${s}\\s*[(<]`),
    // class declaration
    new RegExp(`\\bclass\\s+${s}\\b`),
    // const/let/var declaration
    new RegExp(`\\b(?:const|let|var)\\s+${s}\\b\\s*[:=]`),
    // any exported declaration, including `export default function POST` route handlers
    new RegExp(`\\bexport\\s+(?:default\\s+)?(?:async\\s+)?(?:function\\*?|class|const|let|var)\\s+${s}\\b`),
    // `export { foo }` / `export { bar as foo }`
    new RegExp(`\\bexport\\s*\\{[^}]*\\b${s}\\b[^}]*\\}`),
    // object or class method shorthand: `foo(args) {`, optionally with modifiers/generics
    new RegExp(`(?:^|[\\s,{])(?:public\\s+|private\\s+|protected\\s+|static\\s+|async\\s+|\\*\\s*)*${s}\\s*(?:<[^>]*>)?\\([^)]*\\)\\s*(?::[^{]+)?\\{`, "m"),
    // object property assigned a function: `foo: function`, `foo: async () =>`
    new RegExp(`\\b${s}\\s*:\\s*(?:async\\s*)?function\\b`),
    new RegExp(`\\b${s}\\s*:\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>`),
    // arrow-function assignment: `const foo = (...) =>`, `foo = async (x) =>`, `foo = x =>`
    new RegExp(`\\b${s}\\s*=\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>`),
    new RegExp(`\\b${s}\\s*=\\s*(?:async\\s*)?\\w+\\s*=>`),
  ];
}

function symbolAppearsIn(content: string, symbol: string): boolean {
  const cleaned = stripComments(content);
  return buildSymbolPatterns(symbol).some((pattern) => pattern.test(cleaned));
}

export interface SourceCheckRef {
  file: string;
  symbol?: string | undefined;
}

/**
 * Checks a single `{ file, symbol? }` reference against the repository on disk.
 * Best-effort and cached per `(absolutePath, mtimeMs, size, symbol)` so repeated checks across a
 * reload do not re-read every file. The size is part of the key because some filesystems can
 * expose the same millisecond mtime for two immediate writes.
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

  if (ref.symbol === undefined) {
    return "file-only";
  }

  const extension = path.extname(resolved.absolutePath).toLowerCase();
  if (!CODE_EXTENSIONS.has(extension)) {
    return "file-only";
  }

  const cacheKey = `${resolved.absolutePath}::${stats.mtimeMs}::${stats.size}::${ref.symbol}`;
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  if (stats.size > MAX_FILE_SIZE_BYTES) {
    cacheSet(cacheKey, "file-only");
    return "file-only";
  }

  let content: string;
  try {
    content = readFileSync(resolved.absolutePath, "utf-8");
  } catch {
    cacheSet(cacheKey, "file-only");
    return "file-only";
  }

  const status: SourceStatus = symbolAppearsIn(content, ref.symbol) ? "verified" : "file-only";
  cacheSet(cacheKey, status);
  return status;
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
