import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { Check } from "@phosphor-icons/react";
import { Handle, Position, useNodeConnections, type NodeProps } from "@xyflow/react";
import { categoryToken } from "../../../design/semantics";
import { Badge } from "../../primitives";
import { purposeLineCount } from "../nodeContent";
import type { StepFlowNode } from "../types";
import styles from "./StepNode.module.css";

/**
 * The single, most important visual component in the product (contract §10). The
 * collapsed card shows index/name/purpose/category; per-step expand adds I/O,
 * files, and symbols. The card itself is the roving-tabindex target (`data-step-node`, `tabIndex`,
 * `onKeyDown` all come from `useCanvasKeyboardNav` via node data) — never measured, its box is
 * exactly the size `layout.ts` computed for it.
 *
 * Deliberately *not* on the card: source/edge-case/test counts. A count is a number nobody
 * acts on — the counts now live on the drawer's own section headings, where the full lists
 * they summarise already are.
 *
 * Category is carried by the card's own accent gradient rather than by a spine: see `.card` in the
 * stylesheet for why the leading edge tops out at 15%.
 */
/** Feeds the hover spotlight its position without a re-render: two custom properties, in %. */
function trackSpotlight(event: ReactPointerEvent<HTMLDivElement>): void {
  const rect = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty("--mx", `${((event.clientX - rect.left) / rect.width) * 100}%`);
  event.currentTarget.style.setProperty("--my", `${((event.clientY - rect.top) / rect.height) * 100}%`);
}

export function StepNode({ id, data }: NodeProps<StepFlowNode>) {
  const {
    step,
    index,
    selected,
    hasMissingSource,
    hasFailureOutcome,
    hasSuccessOutcome,
    hasRetry,
    hasReturnIn,
    hasReturnOut,
    dimmed,
    tabIndex,
    onKeyDown,
    onHoverStart,
    onHoverEnd,
  } = data;
  const category = categoryToken(step.category);
  const sourceConnections = useNodeConnections({ id, handleType: "source" });
  const activeSourceHandles = new Set(sourceConnections.map((connection) => connection.sourceHandle));
  const sourceHandleClassName = (handleId: string) =>
    activeSourceHandles.has(handleId) ? styles.handle : styles.handleHidden;

  // The open step card sits on this node's corner; the selection ring would peek out around it.
  const underCard = selected;
  const cardClassName = [styles.card, selected ? styles.selected : "", underCard ? styles.underCard : "", dimmed ? styles.dimmed : ""]
    .filter(Boolean)
    .join(" ");
  const purposeLines = purposeLineCount(step.purpose);
  const purposeClassName =
    purposeLines === 3
      ? `${styles.purpose} ${styles.purposeThreeLine}`
      : purposeLines === 2
        ? `${styles.purpose} ${styles.purposeTwoLine}`
        : styles.purpose;
  const accessibleName = `${index + 1}. ${step.name}. ${category.label} category.${
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
      onPointerMove={trackSpotlight}
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
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

      <div className={styles.body}>
        <div className={styles.header}>
          <span className={styles.index} aria-hidden="true">
            {String(index + 1).padStart(2, "0")}
          </span>
          <span className={styles.name}>{step.name}</span>
          {selected ? <Check size={14} weight="bold" className={styles.selectedIcon} aria-hidden="true" /> : null}
          {hasMissingSource ? <Badge tone="red">Missing sources</Badge> : null}
        </div>

        <p className={purposeClassName}>{step.purpose}</p>

        <div className={styles.footer}>
          {/* No inline colour: the label derives its own from `--node-accent` in CSS, nudged toward
              the text colour for contrast against the tinted footer. An inline style here would
              win the cascade and put it back under AA. */}
          <span className={styles.categoryLabel}>{category.label}</span>
        </div>
      </div>
    </div>
  );
}
