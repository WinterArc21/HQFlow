/**
 * Pure, framework-free helpers describing what a `StepNode` shows at each depth level, and how
 * tall that content is. `layout.ts` uses `computeNodeHeight` to size nodes; `StepNode.tsx` uses
 * the list-building helpers to render exactly the same rows it was sized for — one source of
 * truth, so the deterministic layout in `layout.ts` can never drift from what actually renders.
 */
import type { DataReference, SourceReference, WorkflowStep } from "@schema/workflow";
import type { SourceStatus } from "../../api/types";
import type { Depth } from "../../store/useCodeHQStore";

/** Fixed node width across every depth — only height grows with content (contract §10/§11).
 * Wider than the original 300/340px: the spine layout (see layout.ts) reserves enough horizontal
 * room for long branch edges while keeping more canvas width for the card itself. That space is
 * spent on the purpose line and the in/out tags, which were truncating too aggressively to read
 * as the comprehension surface the product needs them to be. */
export const NODE_WIDTH = 380;

export const MAX_MODULE_ROWS = 5;
export const MAX_SYMBOL_ROWS = 8;

// Mirrors `--space-1` (4px) — see `.body`'s padding in `StepNode.module.css`. Tighter than the
// original 8px: the two-line purpose reservation below (needed to stop hard-truncating purpose
// text) has to be paid for somewhere, and slack padding is cheaper to spend than row content.
const BODY_PADDING_Y = 12;
// Matches the 24px `IconButton` "sm" square that now lives inline in the header (the per-step
// expand toggle moved there from its own row, see StepNode.tsx) so the row never clips it.
const HEADER_ROW_HEIGHT = 40;
/** Height of one purpose line. `purposeLineCount` decides whether a card reserves one or two of
 * these — see its own doc comment for why that's a character count, not a DOM measurement. */
export const PURPOSE_LINE_HEIGHT = 16;
/** Purposes at or under this length almost always fit on one line at `NODE_WIDTH`; anything
 * longer gets a second line reserved instead of hard-truncating mid-sentence (contract: "the
 * purpose is a primary comprehension surface — losing half of it defeats the product's point").
 * A character-count heuristic, not a DOM measurement: `computeNodeHeight` must stay pure and
 * DOM-free (contract §11), so it can only approximate what will wrap, not know it exactly — an
 * approximation is an acceptable trade for a layout that never needs the browser to compute. */
export const PURPOSE_SINGLE_LINE_MAX_CHARS = 52;
const FOOTER_ROW_HEIGHT = 30;
const DETAIL_SEPARATOR_PADDING = 5;
const SECTION_LABEL_HEIGHT = 14;
const FILE_ROW_HEIGHT = 14;
// Slightly taller than a file row: a symbol row carries more content (file + arrow + symbol()),
// and keeping it taller guarantees `symbols` depth is strictly taller than `modules` depth even
// when both show the same number of rows (contract requirement: node height grows with depth).
const SYMBOL_ROW_HEIGHT = 16;
const MORE_ROW_HEIGHT = 14;

/** Fixed height for every outcome pill — always collapsed to a name + one purpose line, never
 * growing with depth (contract: outcome nodes are "clearly not units of work", so they don't
 * participate in the Story / Code map / expand altitude ladder at all). */
export const OUTCOME_NODE_HEIGHT = 64;
const OUTCOME_NODE_MIN_WIDTH = 200;
const OUTCOME_NODE_MAX_WIDTH = 300;
/** Fixed chrome every outcome pill reserves regardless of text: the glyph, its gap to the text
 * column, and left/right padding. */
const OUTCOME_NODE_CHROME_WIDTH = 76;
/** Approximate px-per-character at the outcome name's font size/weight (`--fs-base`, 600) — the
 * same character-count-heuristic approach `PURPOSE_SINGLE_LINE_MAX_CHARS` already uses, so
 * `computeOutcomeNodeWidth` stays as DOM-free and pure as the rest of this file (contract: "Do
 * not measure the DOM"). Deliberately generous (over-estimates) since undershooting a pill's
 * width is the exact nit this sizing exists to fix (a name overrunning its own border). */
const OUTCOME_NAME_CHAR_WIDTH = 8;

/**
 * A terminal ("outcome") step's pill sizes to its own name — long enough to read "429 Too Many"
 * without clipping, capped so one long name can't blow the outcome column out to spine width.
 * `StepNode`'s counterpart (`NODE_WIDTH`) is a fixed constant instead because a work-step's card
 * carries file paths, counts, and I/O tags whose layout genuinely depends on a stable width; an
 * outcome pill carries only a glyph and two lines of text, so sizing it to content is both safe
 * and the fix the mockup review flagged ("text slightly overran its pill border").
 */
export function computeOutcomeNodeWidth(step: WorkflowStep): number {
  const estimated = OUTCOME_NODE_CHROME_WIDTH + step.name.length * OUTCOME_NAME_CHAR_WIDTH;
  return Math.min(OUTCOME_NODE_MAX_WIDTH, Math.max(OUTCOME_NODE_MIN_WIDTH, estimated));
}

export interface StepIoSummary {
  inputs: DataReference[];
  outputs: DataReference[];
}

/** The data flowing in and out of a step — the connective tissue between steps that, before this
 * redesign, only appeared in the drawer. Surfaced compactly on the card itself (contract §10.2:
 * "surfacing them, even compactly, is a big comprehension win"). */
export function stepIoSummary(step: WorkflowStep): StepIoSummary {
  return { inputs: step.inputs ?? [], outputs: step.outputs ?? [] };
}

/**
 * Story altitude (`workflow`) keeps type-level I/O off the card so the board reads as a product
 * narrative. Code map (`modules`) and per-step expand (`symbols`) surface IN/OUT — that's where
 * type names earn their keep. Layout and render must agree on this gate (contract §11).
 */
export function showsIoOnCard(effectiveDepth: Depth): boolean {
  return effectiveDepth === "modules" || effectiveDepth === "symbols";
}

/** Whether a step's purpose should reserve one or two lines on its card (see
 * `PURPOSE_SINGLE_LINE_MAX_CHARS`'s doc comment for why this is a length heuristic). */
export function purposeLineCount(purpose: string): 1 | 2 {
  return purpose.length > PURPOSE_SINGLE_LINE_MAX_CHARS ? 2 : 1;
}

/** Renders a short "first name, +N more" summary for a list of `DataReference`s — used for the
 * compact inputs/outputs text on a collapsed card. Never truncates by measuring; a caller that
 * needs to guarantee a fixed row height still relies on CSS `text-overflow: ellipsis`. */
export function formatDataReferenceNames(refs: DataReference[]): string {
  if (refs.length === 0) {
    return "";
  }
  const [first, ...rest] = refs;
  return rest.length > 0 ? `${first?.name}, +${rest.length}` : (first?.name ?? "");
}

/** Splits a repo-relative path into its directory prefix (kept) and basename. */
export function splitPath(file: string): { dir: string; base: string } {
  const separatorIndex = file.lastIndexOf("/");
  if (separatorIndex === -1) {
    return { dir: "", base: file };
  }
  return { dir: file.slice(0, separatorIndex + 1), base: file.slice(separatorIndex + 1) };
}

/** Distinct source files referenced by a step's `sources`, in first-seen order (depth `modules`). */
export function stepModuleFiles(step: WorkflowStep): string[] {
  const seen = new Set<string>();
  const files: string[] = [];
  for (const source of step.sources ?? []) {
    if (!seen.has(source.file)) {
      seen.add(source.file);
      files.push(source.file);
    }
  }
  return files;
}

export interface StepSymbolRow {
  file: string;
  symbol?: string;
}

/**
 * One row per distinct (file, symbol) pair referenced by a step's `sources`, in first-seen
 * order (depth `symbols`). A source with no `symbol` still produces a file-only row, so nothing
 * a step references is silently dropped when going one level deeper than `modules`.
 */
export function stepSymbolRows(step: WorkflowStep): StepSymbolRow[] {
  const seen = new Set<string>();
  const rows: StepSymbolRow[] = [];
  for (const source of step.sources ?? []) {
    const key = `${source.file}#${source.symbol ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    rows.push(source.symbol !== undefined ? { file: source.file, symbol: source.symbol } : { file: source.file });
  }
  return rows;
}

function isStepIdExpanded(expandedStepIds: ReadonlySet<string> | Record<string, true>, stepId: string): boolean {
  if (expandedStepIds instanceof Set) {
    return expandedStepIds.has(stepId);
  }
  // `instanceof Set` only narrows the concrete `Set` class, not the structural `ReadonlySet`
  // half of the union, so TS can't drop it here on its own — the two branches are exhaustive.
  return (expandedStepIds as Record<string, true>)[stepId] === true;
}

/**
 * A step's per-node expand toggle overrides the global altitude for that one step only:
 * expanding always shows the deepest (`symbols`) view regardless of Story vs Code map;
 * collapsing falls back to the global altitude.
 */
export function effectiveDepthForStep(
  step: WorkflowStep,
  depth: Depth,
  expandedStepIds: ReadonlySet<string> | Record<string, true>,
): Depth {
  return isStepIdExpanded(expandedStepIds, step.id) ? "symbols" : depth;
}

function sourceCheckKey(ref: Pick<SourceReference, "file" | "symbol">): string {
  return ref.symbol !== undefined ? `${ref.file}#${ref.symbol}` : ref.file;
}

/**
 * Every `sourceChecks` key that could describe this step (mirrors the key derivation in
 * `src/core/source-check.ts`: `sources`, `tests`, and `edgeCases[].sources`).
 */
export function stepSourceCheckKeys(step: WorkflowStep): string[] {
  const keys: string[] = [];
  for (const source of step.sources ?? []) {
    keys.push(sourceCheckKey(source));
  }
  for (const test of step.tests ?? []) {
    keys.push(sourceCheckKey(test));
  }
  for (const edgeCase of step.edgeCases ?? []) {
    for (const source of edgeCase.sources ?? []) {
      keys.push(sourceCheckKey(source));
    }
  }
  return keys;
}

/** Whether any of this step's source/test references resolves to `"missing"` on disk. */
export function stepHasMissingSource(step: WorkflowStep, sourceChecks: Record<string, SourceStatus>): boolean {
  return stepSourceCheckKeys(step).some((key) => sourceChecks[key] === "missing");
}

/**
 * Deterministic node height for a step at a given effective depth. Purely structural — driven
 * only by which rows are present and capped list lengths, never by measuring wrapped text —
 * so it is identical in a Node test and in the browser (contract §11: "Do not measure the DOM").
 */
export function computeNodeHeight(step: WorkflowStep, effectiveDepth: Depth): number {
  let height = HEADER_ROW_HEIGHT + BODY_PADDING_Y * 2 + PURPOSE_LINE_HEIGHT * purposeLineCount(step.purpose) + FOOTER_ROW_HEIGHT;

  if (effectiveDepth === "modules") {
    const files = stepModuleFiles(step);
    if (files.length > 0) {
      height += DETAIL_SEPARATOR_PADDING + SECTION_LABEL_HEIGHT + Math.min(files.length, MAX_MODULE_ROWS) * FILE_ROW_HEIGHT;
      if (files.length > MAX_MODULE_ROWS) {
        height += MORE_ROW_HEIGHT;
      }
    }
  }

  if (effectiveDepth === "symbols") {
    const rows = stepSymbolRows(step);
    if (rows.length > 0) {
      height += DETAIL_SEPARATOR_PADDING + SECTION_LABEL_HEIGHT + Math.min(rows.length, MAX_SYMBOL_ROWS) * SYMBOL_ROW_HEIGHT;
      if (rows.length > MAX_SYMBOL_ROWS) {
        height += MORE_ROW_HEIGHT;
      }
    }
  }

  return height;
}
