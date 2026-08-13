import type { CSSProperties } from "react";
import { CaretDown, CaretUp, Check } from "@phosphor-icons/react";
import { Handle, Position, useNodeConnections, type NodeProps } from "@xyflow/react";
import { categoryToken, confidenceStyle } from "../../../design/semantics";
import { Badge, IconButton } from "../../primitives";
import { formatDataReferenceNames, purposeLineCount, showsIoOnCard, stepIoSummary } from "../nodeContent";
import type { StepFlowNode } from "../types";
import { StepNodeDetail } from "./StepNodeDetail";
import styles from "./StepNode.module.css";

/**
 * The single, most important visual component in the product (contract §10). Story altitude
 * shows index/name/purpose/category; Code map adds IN/OUT and files; per-step expand adds
 * symbols. The card itself is the roving-tabindex target (`data-step-node`, `tabIndex`,
 * `onKeyDown` all come from `useCanvasKeyboardNav` via node data) — never measured, its box is
 * exactly the size `layout.ts` computed for it.
 *
 * Deliberately *not* on the card: the confidence badge and the source/edge-case/test counts. A
 * badge reading "Verified" on almost every step spends a row to say nothing, and a count is a
 * number nobody acts on — the counts now live on the drawer's own section headings, where the
 * full lists they summarise already are. Confidence survives as a shape — a dashed leading edge
 * on inferred steps only — and in the card's accessible name, so nothing is lost for a screen
 * reader or for the "which of these did the agent guess at?" question; it just stops shouting.
 *
 * Category is carried by the card's own accent gradient rather than by a spine: see `.card` in the
 * stylesheet for why the leading edge tops out at 15%.
 */
export function StepNode({ id, data }: NodeProps<StepFlowNode>) {
  const {
    step,
    index,
    effectiveDepth,
    expanded,
    selected,
    hasMissingSource,
    hasFailureOutcome,
    hasSuccessOutcome,
    hasRetry,
    hasReturnIn,
    hasReturnOut,
    dimmed,
    tabIndex,
    onToggleExpand,
    onKeyDown,
    onHoverStart,
    onHoverEnd,
    onFocusStep,
    onBlurStep,
  } = data;
  const category = categoryToken(step.category);
  const confidence = confidenceStyle(step.confidence);
  const io = stepIoSummary(step);
  const inSummary = formatDataReferenceNames(io.inputs);
  const outSummary = formatDataReferenceNames(io.outputs);
  const showIo = showsIoOnCard(effectiveDepth) && (inSummary.length > 0 || outSummary.length > 0);
  const sourceConnections = useNodeConnections({ id, handleType: "source" });
  const activeSourceHandles = new Set(sourceConnections.map((connection) => connection.sourceHandle));
  const sourceHandleClassName = (handleId: string) =>
    activeSourceHandles.has(handleId) ? styles.handle : styles.handleHidden;

  const cardClassName = [styles.card, selected ? styles.selected : "", dimmed ? styles.dimmed : ""]
    .filter(Boolean)
    .join(" ");
  const showInferredEdge = confidence.marker === "dashed";
  const purposeLines = purposeLineCount(step.purpose);
  const purposeClassName =
    purposeLines === 3
      ? `${styles.purpose} ${styles.purposeThreeLine}`
      : purposeLines === 2
        ? `${styles.purpose} ${styles.purposeTwoLine}`
        : styles.purpose;
  const accessibleName = `${index + 1}. ${step.name}. ${category.label} category. ${confidence.label} confidence.${
    hasMissingSource ? " Missing sources." : ""
  }`;
  const cardStyle = { "--node-accent": `var(${category.varName})` } as CSSProperties;

  return (
    <div
      className={cardClassName}
      data-step-node={step.id}
      role="button"
      tabIndex={tabIndex}
      aria-label={accessibleName}
      aria-current={selected ? "true" : undefined}
      style={cardStyle}
      onKeyDown={onKeyDown}
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
      onFocus={onFocusStep}
      onBlur={onBlurStep}
    >
      {/* Only source ports carrying an edge are visible. A target's arrival is already marked by
          the arrowhead, so target-side dots would double up on that same point. Dynamic source
          ports become visible on whichever side the live edge geometry selects. */}
      <Handle id="in" type="target" position={Position.Left} className={styles.handleHidden} aria-hidden="true" />
      <Handle id="out" type="source" position={Position.Right} className={sourceHandleClassName("out")} aria-hidden="true" />
      <Handle id="in-right" type="target" position={Position.Right} className={styles.handleHidden} aria-hidden="true" />
      <Handle id="in-top" type="target" position={Position.Top} className={styles.handleHidden} aria-hidden="true" />
      <Handle id="in-bottom" type="target" position={Position.Bottom} className={styles.handleHidden} aria-hidden="true" />
      <Handle id="out-left" type="source" position={Position.Left} className={sourceHandleClassName("out-left")} aria-hidden="true" />
      <Handle id="out-top" type="source" position={Position.Top} className={sourceHandleClassName("out-top")} aria-hidden="true" />
      <Handle id="out-bottom" type="source" position={Position.Bottom} className={sourceHandleClassName("out-bottom")} aria-hidden="true" />
      {hasFailureOutcome ? <Handle id="failure" type="source" position={Position.Top} className={`${styles.handle} ${styles.failureHandle}`} aria-hidden="true" /> : null}
      {hasSuccessOutcome ? <Handle id="success" type="source" position={Position.Bottom} className={`${styles.handle} ${styles.successHandle}`} aria-hidden="true" /> : null}
      {hasReturnIn ? <Handle id="return-in" type="target" position={Position.Top} className={styles.handleHidden} aria-hidden="true" /> : null}
      {hasReturnOut ? <Handle id="return-out" type="source" position={Position.Top} className={`${styles.handle} ${styles.returnOutHandle}`} aria-hidden="true" /> : null}
      {hasRetry ? (
        <>
          <Handle id="retry-in" type="target" position={Position.Right} className={styles.handleHidden} aria-hidden="true" />
          <Handle id="retry-out" type="source" position={Position.Right} className={`${styles.handle} ${styles.retryOutHandle}`} aria-hidden="true" />
        </>
      ) : null}

      {/* Category is now carried by the card's own accent gradient (contract §10: colour always
          encodes category, never confidence), which leaves this element carrying confidence alone —
          so it only renders for the case it needs to call out. A dashed leading edge means the
          agent inferred this step; a clean edge means verified or human-confirmed. Still a shape
          difference rather than a second colour, so "never colour alone" holds. */}
      {showInferredEdge ? <span className={styles.inferredEdge} aria-hidden="true" /> : null}

      <div className={styles.body}>
        <div className={styles.header}>
          <span className={styles.index} aria-hidden="true">
            {String(index + 1).padStart(2, "0")}
          </span>
          <span className={styles.name}>{step.name}</span>
          {selected ? <Check size={14} weight="bold" className={styles.selectedIcon} aria-hidden="true" /> : null}
          {hasMissingSource ? <Badge tone="red">Missing sources</Badge> : null}
          {/* Quiet until wanted: the toggle only paints once the card is hovered or holds focus
              (or is already expanded, so the control that undoes that never vanishes out from
              under the pointer). It keeps its box at all times — `opacity`, never `display` — so
              revealing it can't reflow the header, and it stays reachable and hit-testable for
              keyboard and assistive tech regardless of what the mouse is doing. */}
          <span className={`${styles.expandToggle} ${expanded ? styles.expandTogglePinned : ""}`}>
            <IconButton
              label={expanded ? `Collapse ${step.name}` : `Expand ${step.name} to show code details`}
              icon={expanded ? <CaretUp size={12} /> : <CaretDown size={12} />}
              size="sm"
              tabIndex={-1}
              onClick={(event) => {
                event.stopPropagation();
                onToggleExpand();
              }}
            />
          </span>
        </div>

        <p className={purposeClassName}>{step.purpose}</p>

        <StepNodeDetail step={step} depth={effectiveDepth} />

        <div className={styles.footer}>
          {/* No inline colour: the label derives its own from `--node-accent` in CSS, nudged toward
              the text colour for contrast against the tinted footer. An inline style here would
              win the cascade and put it back under AA. */}
          <span className={styles.categoryLabel}>{category.label}</span>
          {showIo ? (
            <span className={styles.factsIo}>
              {inSummary.length > 0 ? (
                <span className={styles.ioTag} title={`Input: ${inSummary}`}>
                  <span className={styles.ioLabel}>in</span>
                  <span className={styles.ioValue}>{inSummary}</span>
                </span>
              ) : null}
              {outSummary.length > 0 ? (
                <span className={styles.ioTag} title={`Output: ${outSummary}`}>
                  <span className={styles.ioLabel}>out</span>
                  <span className={styles.ioValue}>{outSummary}</span>
                </span>
              ) : null}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
