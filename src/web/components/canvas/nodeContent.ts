/**
 * Pure, framework-free helpers describing what a `StepNode` shows at each depth level, and how
 * tall that content is. `layout.ts` uses `computeNodeHeight` to size nodes; `StepNode.tsx` uses
 * the list-building helpers to render exactly the same rows it was sized for — one source of
 * truth, so the deterministic layout in `layout.ts` can never drift from what actually renders.
 */
import type { SourceReference, WorkflowStep } from "@schema/workflow";
import type { SourceStatus } from "../../api/types";

/** Fixed node width across every depth — only height grows with content (contract §10/§11).
 * 320px is option A: 60px narrower than the 380px slab, so a typical board shows more of the
 * pipeline and the purpose can wrap as a short block instead of a thin strip with empty paper
 * on the right. Still wide enough that titles such as "Understand Product" do not clip. */
export const NODE_WIDTH = 320;

// Mirrors the purpose top margin and footer top margin in `StepNode.module.css`. 15px, not the
// original 12px: option A spends those 6 extra pixels so a three-line purpose card lands on
// 148px instead of 142px, which is the box that was chosen against the 380 × 126 slab.
const BODY_PADDING_Y = 15;
// Matches the 24px `IconButton` "sm" square that now lives inline in the header (the per-step
// expand toggle moved there from its own row, see StepNode.tsx) so the row never clips it.
const HEADER_ROW_HEIGHT = 40;
/** Height of one purpose line. `purposeLineCount` decides whether a card reserves one, two, or
 * three of these — see its own doc comment for why that's a character count, not a DOM measurement. */
export const PURPOSE_LINE_HEIGHT = 16;
/** Purposes at or under this length almost always fit on one line at `NODE_WIDTH`. Scaled down
 * from the old 52-char / 380px rule: at 320px the purpose column is about 294px, ~42 characters
 * at `--fs-tiny`. A character-count heuristic, not a DOM measurement: `computeNodeHeight` must
 * stay pure and DOM-free (contract §11). */
export const PURPOSE_SINGLE_LINE_MAX_CHARS = 42;
/** Purposes longer than one line but at or under this length get two lines; anything longer
 * reserves three so a purpose such as Understand Product (108 chars) is not hard-truncated. */
export const PURPOSE_TWO_LINE_MAX_CHARS = 84;
const FOOTER_ROW_HEIGHT = 30;

/** Fixed height for every outcome pill — always collapsed to a name + one purpose line, never
 * growing with expand (contract: outcome nodes are "clearly not units of work", so they don't
 * participate in the story / expand ladder at all). */
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

/** Whether a step's purpose should reserve one, two, or three lines on its card (see
 * `PURPOSE_SINGLE_LINE_MAX_CHARS`'s doc comment for why this is a length heuristic). */
export function purposeLineCount(purpose: string): 1 | 2 | 3 {
  if (purpose.length <= PURPOSE_SINGLE_LINE_MAX_CHARS) {
    return 1;
  }
  return purpose.length <= PURPOSE_TWO_LINE_MAX_CHARS ? 2 : 3;
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
export function computeNodeHeight(step: WorkflowStep): number {
  const height = HEADER_ROW_HEIGHT + BODY_PADDING_Y * 2 + PURPOSE_LINE_HEIGHT * purposeLineCount(step.purpose) + FOOTER_ROW_HEIGHT;

  return height;
}
