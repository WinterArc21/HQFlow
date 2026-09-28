import { Check, Minus, X } from "@phosphor-icons/react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { describeChangedFiles } from "../nodeContent";
import type { OutcomeFlowNode } from "../types";
import styles from "./OutcomeNode.module.css";

const TONE_CLASS_NAMES = {
  success: styles.success,
  failure: styles.failure,
  neutral: styles.neutral,
} as const;

const TONE_LABELS = {
  success: "Success outcome",
  failure: "Failure outcome",
  neutral: "Outcome",
} as const;

/**
 * A terminal step's pill — "clearly not a unit of work" (contract §10): a compact rounded card
 * with a tone glyph instead of the category marker, name, and (when present) a single purpose
 * line. Sized to its own content by `layout.ts`/`nodeContent.ts`'s `computeOutcomeNodeWidth`
 * rather than the fixed `NODE_WIDTH` every `StepNode` uses — an outcome pill never grows with
 * depth and never shows files/symbols, so there is nothing here for the depth ladder to expand
 * into.
 */
export function OutcomeNode({ data }: NodeProps<OutcomeFlowNode>) {
  const { step, tone, band, changedFiles, dimmed, tabIndex, onKeyDown, onHoverStart, onHoverEnd, onFocusStep, onBlurStep } = data;
  const cardClassName = [styles.card, TONE_CLASS_NAMES[tone], dimmed ? styles.dimmed : ""].filter(Boolean).join(" ");
  const accessibleName = `${TONE_LABELS[tone]}: ${step.name}.${step.purpose.length > 0 ? ` ${step.purpose}` : ""}${
    changedFiles.length > 0 ? " Code changed since this outcome was mapped." : ""
  }`;

  return (
    <div
      className={cardClassName}
      data-step-node={step.id}
      role="button"
      tabIndex={tabIndex}
      aria-label={accessibleName}
      onKeyDown={onKeyDown}
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
      onFocus={onFocusStep}
      onBlur={onBlurStep}
    >
      {/* Outcome edges keep their success/failure semantics in the edge renderer, while their
          physical attachment follows the same live cardinal choice as work-card edges. */}
      <Handle id="in" type="target" position={Position.Left} className={styles.handle} aria-hidden="true" />
      <Handle id="in-right" type="target" position={Position.Right} className={styles.handle} aria-hidden="true" />
      <Handle id="in-top" type="target" position={Position.Top} className={styles.handle} aria-hidden="true" />
      <Handle id="in-bottom" type="target" position={Position.Bottom} className={styles.handle} aria-hidden="true" />
      <Handle id="outcome-in" type="target" position={band === "failure" ? Position.Bottom : Position.Top} className={styles.handle} aria-hidden="true" />

      {/* A pill is sized to its own text by `layout.ts`, so the flag sits on the rim instead of
          taking a badge's width inside it. */}
      {changedFiles.length > 0 ? (
        <span className={styles.changedMarker} title={describeChangedFiles(changedFiles)} data-code-changed />
      ) : null}
      <span className={styles.glyph} data-outcome-glyph={tone} aria-hidden="true">
        {tone === "failure" ? (
          <X size={13} weight="bold" />
        ) : tone === "success" ? (
          <Check size={13} weight="bold" />
        ) : (
          <Minus size={13} weight="bold" />
        )}
      </span>
      <span className={styles.text}>
        <span className={styles.name}>{step.name}</span>
        {step.purpose.length > 0 ? <span className={styles.purpose}>{step.purpose}</span> : null}
      </span>
    </div>
  );
}
