import { useEffect, useId, useRef, useState } from "react";
import type { Workflow } from "@schema/workflow";
import { connectionStyle, outcomeEdgeStyle, outcomeTone, RETRY_EDGE_VISUAL, type ConnectionVisual } from "../../design/semantics";
import { computeIncomingTypes, computeOutcomeStepIds } from "./graph";
import { DOT_STEP, type GridPlacement } from "../shell/dotGrid";
import { useGridBox } from "../shell/Island";
import styles from "./CanvasLegend.module.css";

interface CanvasLegendProps {
  workflow: Workflow;
  /** True while a step trace is active; the legend is context, so it dims with the canvas. */
  dimmed?: boolean;
  /** Snaps the key onto the dot grid (island shell); without it, it sits in the stage corner. */
  placement?: GridPlacement;
  /** With `placement`: the widest the key may be, in dots, where `placement` puts it. */
  maxWidth?: number;
  /** With `placement`: pixels the key rises when it is wider than `maxWidth`. */
  lift?: number;
  /** Called with a row's key while the pointer is on that row, and `null` after. */
  onHighlight?: (key: string | null) => void;
}

const CONNECTION_TYPES = ["success", "failure", "conditional", "async"] as const;
const LABELS: Record<(typeof CONNECTION_TYPES)[number], string> = {
  success: "Normal",
  failure: "Failure",
  conditional: "Conditional",
  async: "Async",
};

function swatchStyle(visual: ConnectionVisual) {
  return {
    borderTopColor: `var(${visual.varName})`,
    borderTopStyle: visual.dash === "none" ? "solid" : visual.dash === "dotted" ? "dotted" : "dashed",
    borderTopWidth: visual.weight === "primary" ? 2 : 1,
  } as const;
}

/**
 * A key for only the edge grammar currently visible in this workflow. On the island shell it is a
 * small "Key" chip that opens on hover or tap; pointing at a row there picks out those edges.
 */
export function CanvasLegend({ workflow, dimmed = false, placement, maxWidth, lift = 0, onHighlight }: CanvasLegendProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hovered || pinned;
  const box = useGridBox(contentRef, placement === undefined ? undefined : { ...placement, w: "auto", h: "auto" });
  const lifted = box !== null && maxWidth !== undefined && box.width > maxWidth * DOT_STEP;

  useEffect(() => {
    if (!open) {
      onHighlight?.(null);
    }
  }, [onHighlight, open]);
  useEffect(() => {
    if (!pinned) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setPinned(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPinned(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [pinned]);
  // A self-loop renders with the retry grammar instead of its declared connection grammar, so
  // exclude it from the ordinary rows and add the dedicated Retry row below.
  const outcomeIds = computeOutcomeStepIds(workflow);
  const incomingTypesByStep = computeIncomingTypes(workflow);
  const outcomeBandById = new Map(
    Array.from(outcomeIds, (stepId) => [
      stepId,
      outcomeTone(incomingTypesByStep.get(stepId) ?? []) === "failure" ? "failure" : "success",
    ] as const),
  );
  const isTerminalOutcomeEdge = (connection: Workflow["connections"][number]) => outcomeBandById.has(connection.to);
  const presentTypes = new Set(
    workflow.connections
      .filter((connection) => connection.from !== connection.to && !isTerminalOutcomeEdge(connection))
      .map((connection) => connection.type ?? "success"),
  );
  const rows: Array<{ key: string; label: string; visual: ConnectionVisual }> = CONNECTION_TYPES.filter((type) => presentTypes.has(type)).map((type) => ({
    key: type,
    label: LABELS[type],
    visual: connectionStyle(type),
  }));
  const hasFailureOutcome = Array.from(outcomeBandById.values()).some((band) => band === "failure");
  const hasSuccessOutcome = Array.from(outcomeBandById.values()).some((band) => band === "success");
  if (hasFailureOutcome && !rows.some((row) => row.key === "failure")) {
    rows.push({ key: "failure", label: LABELS.failure, visual: connectionStyle("failure") });
  }
  if (hasSuccessOutcome) {
    rows.push({ key: "success-outcome", label: "Success outcome", visual: outcomeEdgeStyle("success") });
  }
  if (workflow.connections.some((connection) => connection.from === connection.to)) {
    rows.push({ key: "retry", label: "Retry", visual: RETRY_EDGE_VISUAL });
  }
  if (rows.length === 0) return null;

  const rowList = rows.map((row) => (
    <div
      className={styles.row}
      key={row.key}
      {...(box !== null ? { onPointerEnter: () => onHighlight?.(row.key), onPointerLeave: () => onHighlight?.(null) } : {})}
    >
      <span className={styles.swatch} style={swatchStyle(row.visual)} aria-hidden="true" />
      <span>{row.label}</span>
    </div>
  ));

  if (box === null) {
    return (
      <div className={`${styles.legend} ${dimmed ? styles.dimmed : ""}`} role="group" aria-label="Connection legend">
        <div className={styles.rows}>
          <h2 className={styles.heading}>Connections</h2>
          {rowList}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className={`${styles.legend} ${styles.onGrid} ${dimmed && !open ? styles.dimmed : ""} ${open ? styles.open : ""}`}
      style={{ ...box, top: lifted ? box.top - lift : box.top, position: "fixed", bottom: "auto" }}
      onPointerEnter={(event) => { if (event.pointerType === "mouse") setHovered(true); }}
      onPointerLeave={() => setHovered(false)}
    >
      {open ? (
        <div className={styles.popover}>
          <div id={popoverId} className={styles.rows} role="group" aria-label="Connection legend">
            <h2 className={styles.heading}>Connections</h2>
            {rowList}
          </div>
        </div>
      ) : null}
      <div ref={contentRef} className={styles.chipBox}>
        <button
          type="button"
          className={styles.chip}
          aria-expanded={open}
          aria-controls={open ? popoverId : undefined}
          onClick={() => setPinned((value) => !value)}
        >
          <span className={styles.chipGlyph} aria-hidden="true">
            {rows.slice(0, 3).map((row) => (
              <span key={row.key} className={styles.swatch} style={swatchStyle(row.visual)} />
            ))}
          </span>
          Key
        </button>
      </div>
    </div>
  );
}
