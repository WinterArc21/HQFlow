import type { Workflow } from "@schema/workflow";
import { connectionStyle, outcomeEdgeStyle, outcomeTone, RETRY_EDGE_VISUAL, type ConnectionVisual } from "../../design/semantics";
import { computeIncomingTypes, computeOutcomeStepIds } from "./graph";
import styles from "./CanvasLegend.module.css";

interface CanvasLegendProps {
  workflow: Workflow;
  /** True while a step trace is active; the legend is context, so it dims with the canvas. */
  dimmed?: boolean;
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

/** A read-only key for only the edge grammar currently visible in this workflow. */
export function CanvasLegend({ workflow, dimmed = false }: CanvasLegendProps) {
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

  return (
    <div className={`${styles.legend} ${dimmed ? styles.dimmed : ""}`} role="group" aria-label="Connection legend">
      <h2 className={styles.heading}>Connections</h2>
      {rows.map((row) => (
        <div className={styles.row} key={row.key}>
          <span className={styles.swatch} style={swatchStyle(row.visual)} aria-hidden="true" />
          <span>{row.label}</span>
        </div>
      ))}
    </div>
  );
}
