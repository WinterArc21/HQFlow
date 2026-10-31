/**
 * Pure, framework-free helpers describing what a `StepNode` shows at each depth level, and how
 * big a card is. `layout.ts` sizes nodes from `CARD_SIZE`; `StepNode.tsx` uses
 * the list-building helpers to render exactly the same rows it was sized for — one source of
 * truth, so the deterministic layout in `layout.ts` can never drift from what actually renders.
 */
import type { SourceReference, WorkflowStep } from "@schema/workflow";
import type { SourceStatus } from "../../api/types";

/** Fixed step card box. Layout never depends on measuring wrapped text (contract §11).
 * `StepNode.module.css` clamps the purpose to three lines. */
export const CARD_SIZE = { width: 310, height: 136 };

/** Fixed height for every outcome pill — always collapsed to a name + one purpose line, never
 * growing with expand (contract: outcome nodes are "clearly not units of work", so they don't
 * participate in the story / expand ladder at all). */
export const OUTCOME_NODE_HEIGHT = 64;
const OUTCOME_NODE_MIN_WIDTH = 200;
const OUTCOME_NODE_MAX_WIDTH = 300;
/** Fixed chrome every outcome pill reserves regardless of text: the glyph, its gap to the text
 * column, and left/right padding. */
const OUTCOME_NODE_CHROME_WIDTH = 76;
/** Approximate px-per-character at the outcome name's font size/weight (`--fs-base`, 600) — a
 * character-count heuristic, so `computeOutcomeNodeWidth` stays as DOM-free and pure as the rest of this file (contract: "Do
 * not measure the DOM"). Deliberately generous (over-estimates) since undershooting a pill's
 * width is the exact nit this sizing exists to fix (a name overrunning its own border). */
const OUTCOME_NAME_CHAR_WIDTH = 8;

/**
 * A terminal ("outcome") step's pill sizes to its own name — long enough to read "429 Too Many"
 * without clipping, capped so one long name can't blow the outcome column out to spine width.
 * A step card's width is fixed (`CARD_SIZE`) instead because a work-step's card
 * carries file paths, counts, and I/O tags whose layout genuinely depends on a stable width; an
 * outcome pill carries only a glyph and two lines of text, so sizing it to content is both safe
 * and the fix the mockup review flagged ("text slightly overran its pill border").
 */
export function computeOutcomeNodeWidth(step: WorkflowStep): number {
  const estimated = OUTCOME_NODE_CHROME_WIDTH + step.name.length * OUTCOME_NAME_CHAR_WIDTH;
  return Math.min(OUTCOME_NODE_MAX_WIDTH, Math.max(OUTCOME_NODE_MIN_WIDTH, estimated));
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
