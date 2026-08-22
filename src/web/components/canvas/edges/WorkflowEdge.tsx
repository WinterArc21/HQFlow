import { useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, getSmoothStepPath, Position, useReactFlow, type EdgeProps } from "@xyflow/react";
import { connectionStyle, outcomeEdgeStyle, RETRY_EDGE_VISUAL } from "../../../design/semantics";
import { connectionLabelText } from "../edgeLabel";
import type { WorkflowFlowEdge } from "../types";
import { edgeMarkerId } from "./EdgeMarkers";
import styles from "./WorkflowEdge.module.css";

/** Branches turn with a broad radius so they feel routed rather than mechanically elbowed. */
const EDGE_BORDER_RADIUS = 16;
const RETRY_LOOP_OUTSET = 80;
const RETURN_EDGE_LIFT = 84;
const BEND_SNAP_DISTANCE_PX = 30;
const BEND_ENDPOINT_LEAD = 18;

type BendSnap = "source-x" | "target-x" | null;
interface BendState {
  point: { x: number; y: number };
  snap: BendSnap;
  resetKey: string | undefined;
}

function portControlPoint(point: { x: number; y: number }, position: Position, reach: number): { x: number; y: number } {
  switch (position) {
    case Position.Left:
      return { x: point.x - reach, y: point.y };
    case Position.Right:
      return { x: point.x + reach, y: point.y };
    case Position.Top:
      return { x: point.x, y: point.y - reach };
    case Position.Bottom:
      return { x: point.x, y: point.y + reach };
  }
}

function smoothBendPath(
  source: { x: number; y: number },
  sourcePosition: Position,
  bend: { x: number; y: number },
  target: { x: number; y: number },
  targetPosition: Position,
): string {
  const sourceDistance = Math.hypot(bend.x - source.x, bend.y - source.y);
  const targetDistance = Math.hypot(target.x - bend.x, target.y - bend.y);
  const length = Math.hypot(target.x - source.x, target.y - source.y) || 1;
  const tangent = { x: (target.x - source.x) / length, y: (target.y - source.y) / length };
  const tangentReach = Math.min(
    sourceDistance,
    targetDistance,
    length / 2,
  ) * 0.35;
  const sourceLead = portControlPoint(source, sourcePosition, Math.min(BEND_ENDPOINT_LEAD, sourceDistance / 3));
  const targetLead = portControlPoint(target, targetPosition, Math.min(BEND_ENDPOINT_LEAD, targetDistance / 3));
  const sourceControl = portControlPoint(
    sourceLead,
    sourcePosition,
    Math.min(20, sourceDistance / 4),
  );
  const targetControl = portControlPoint(
    targetLead,
    targetPosition,
    Math.min(20, targetDistance / 4),
  );
  return `M${source.x},${source.y} L${sourceLead.x},${sourceLead.y} C${sourceControl.x},${sourceControl.y} ${bend.x - tangent.x * tangentReach},${bend.y - tangent.y * tangentReach} ${bend.x},${bend.y} C${bend.x + tangent.x * tangentReach},${bend.y + tangent.y * tangentReach} ${targetControl.x},${targetControl.y} ${targetLead.x},${targetLead.y} L${target.x},${target.y}`;
}

/** Stroke width per connection type: normal sync flow is the strongest weight; every branch —
 * conditional, failure, async, retry — reads as subordinate but still intentional and legible.
 * The line and arrowhead use the same connection-type discriminator. */
function edgeStrokeWidth(variant: string): number {
  switch (variant) {
    case "success":
      return 2.75;
    case "async":
      return 2;
    case "success-outcome":
    case "failure":
    case "conditional":
    case "retry":
      return 2;
    default:
      return 2.75;
  }
}

const DASH_PATTERNS: Record<"dashed" | "dotted", string> = {
  dashed: "8 6",
  dotted: "1 6",
};

/** How much wider than the semantic stroke the background-coloured casing/halo paints — a solid
 * underlay that carves the dashed line clear of the canvas grid and neighbouring card borders
 * without introducing a neon outline. The halo follows the same path shape (dashes are preserved
 * on the semantic stroke on top); only its width grows. */
const HALO_WIDTH_PADDING = 4;
/** How much a traced edge's stroke grows when path tracing is active (contract §11): tracing must
 * not only dim unrelated paths, it must also strengthen the path the user is following, so the
 * traced line reads as the figure rather than merely the ground. Kept under the next weight tier
 * so hierarchy is reinforced, not flattened. */
const TRACED_STROKE_BOOST = 1;
/** Opacity applied to a dimmed edge during path tracing (contract §11) — a dimmed edge fades to a
 * quiet background tone while traced edges strengthen, so the followed path reads as the figure. */
const DIMMED_OPACITY_FACTOR = 0.25;

/**
 * A directional connector styled from the connection type or terminal outcome band: neutral solid
 * for success/default, green dashed for a successful terminal, muted red dashed for failure, amber
 * dashed for conditional, and neutral dotted for async. Geometry is derived from React Flow's live
 * handle coordinates, so every path remains attached while a card is dragged. The primary path
 * renders bolder than a branch so a reader can follow "what happens next" without consciously
 * parsing colour.
 */
export function WorkflowEdge({ id, data, source, target, sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition }: EdgeProps<WorkflowFlowEdge>) {
  const { screenToFlowPosition, getZoom } = useReactFlow();
  const [bend, setBend] = useState<BendState | null>(null);
  const [draggingForKey, setDraggingForKey] = useState<string | undefined | null>(null);

  if (data === undefined) {
    return null;
  }

  const { connection, retry = false, returnEdge = false, branch = false, outcomeBand, dimmed, traced } = data;
  const activeBend = bend?.resetKey === data.bendResetKey ? bend : null;
  const dragging = draggingForKey === data.bendResetKey;
  const bendable = !retry && !returnEdge && !branch;
  const isRetryLoop = retry;
  const visual = isRetryLoop
    ? RETRY_EDGE_VISUAL
    : outcomeBand !== undefined
      ? outcomeEdgeStyle(outcomeBand)
      : connectionStyle(connection.type);
  const markerVariant = isRetryLoop
    ? "retry"
    : outcomeBand === "success"
      ? "success-outcome"
      : outcomeBand === "failure"
        ? "failure"
        : connection.type;

  let path: string;
  let labelX: number;
  let labelY: number;
  if (isRetryLoop) {
    const bulgeX = Math.max(sourceX, targetX) + RETRY_LOOP_OUTSET;
    path = `M${sourceX},${sourceY} C${bulgeX},${sourceY} ${bulgeX},${targetY} ${targetX},${targetY}`;
    labelX = bulgeX - 2;
    labelY = (sourceY + targetY) / 2;
  } else if (returnEdge) {
    const liftY = Math.min(sourceY, targetY) - RETURN_EDGE_LIFT;
    path = `M${sourceX},${sourceY} C${sourceX},${liftY} ${targetX},${liftY} ${targetX},${targetY}`;
    labelX = (sourceX + targetX) / 2;
    labelY = liftY;
  } else {
    const geometry = branch
      ? getSmoothStepPath({
          sourceX,
          sourceY,
          sourcePosition,
          targetX,
          targetY,
          targetPosition,
          borderRadius: EDGE_BORDER_RADIUS,
          offset: 28,
        })
      : getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, curvature: 0.35 });
    [path, labelX, labelY] = geometry;
  }

  let bendPoint = activeBend?.point;
  if (activeBend?.snap === "source-x") {
    bendPoint = { x: sourceX, y: targetY };
  } else if (activeBend?.snap === "target-x") {
    bendPoint = { x: targetX, y: sourceY };
  }
  if (bendable && bendPoint !== undefined) {
    path = activeBend?.snap === null
      ? smoothBendPath(
          { x: sourceX, y: sourceY },
          sourcePosition,
          bendPoint,
          { x: targetX, y: targetY },
          targetPosition,
        )
      : `M${sourceX},${sourceY} L${bendPoint.x},${bendPoint.y} L${targetX},${targetY}`;
    labelX = bendPoint.x;
    labelY = bendPoint.y;
  }

  const baseStrokeWidth = edgeStrokeWidth(markerVariant ?? "success");
  const strokeWidth = baseStrokeWidth + (traced ? TRACED_STROKE_BOOST : 0);
  const opacity = dimmed ? DIMMED_OPACITY_FACTOR : 1;
  const edgeTransition = "opacity var(--dur-fast) var(--ease-standard), stroke-width var(--dur-fast) var(--ease-standard)";
  const edgeStyle: CSSProperties = {
    stroke: `var(${visual.varName})`,
    strokeWidth,
    opacity,
    transition: edgeTransition,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };
  if (visual.dash === "dotted") {
    // Async reads as rounded beads: a 1-unit dash with round line-caps becomes a dot whose
    // diameter is the stroke width, spaced every 5 units — a continuous-looking bead chain
    // rather than the brittle pixel stipple a butt-capped "1 5" would render.
    edgeStyle.strokeDasharray = DASH_PATTERNS.dotted;
    edgeStyle.strokeLinecap = "round";
  } else if (visual.dash === "dashed") {
    edgeStyle.strokeDasharray = DASH_PATTERNS.dashed;
  }

  // The casing/halo: a solid background-coloured underlay 4px wider than the semantic stroke,
  // painted beneath the dashed line so dashes and shape are preserved on top. It separates the
  // edge from the canvas grid and card borders without a neon outline. It carries the same
  // opacity/transition as the semantic stroke so a dimmed edge's halo fades with it, and it never
  // captures pointer events (edges are not interactive; nodes drive path tracing).
  const haloStyle: CSSProperties = {
    stroke: "var(--bg-canvas)",
    strokeWidth: strokeWidth + HALO_WIDTH_PADDING,
    opacity,
    transition: edgeTransition,
    pointerEvents: "none",
  };

  const labelText = isRetryLoop ? (connectionLabelText(connection) ?? "retry") : connectionLabelText(connection);
  const showLabel = labelText !== undefined;
  const handlePoint = bendPoint ?? { x: labelX, y: labelY };

  const handleBendMove = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (!dragging) {
      return;
    }
    event.stopPropagation();
    const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const snapDistance = BEND_SNAP_DISTANCE_PX / getZoom();
    const candidates = ([
      { point: { x: sourceX, y: targetY }, snap: "source-x" },
      { point: { x: targetX, y: sourceY }, snap: "target-x" },
    ] satisfies Array<{ point: { x: number; y: number }; snap: Exclude<BendSnap, null> }>).filter(({ point: corner }) => (
      Math.hypot(corner.x - sourceX, corner.y - sourceY) > 1
      && Math.hypot(targetX - corner.x, targetY - corner.y) > 1
    ));
    const nearest = candidates
      .map((candidate) => ({ ...candidate, distance: Math.hypot(point.x - candidate.point.x, point.y - candidate.point.y) }))
      .sort((a, b) => a.distance - b.distance)[0];
    setBend(nearest !== undefined && nearest.distance <= snapDistance
      ? { point: nearest.point, snap: nearest.snap, resetKey: data.bendResetKey }
      : { point, snap: null, resetKey: data.bendResetKey });
  };

  return (
    <>
      <g data-workflow-edge={id} data-edge-source={source} data-edge-target={target}>
        <path d={path} fill="none" style={haloStyle} />
        <BaseEdge path={path} markerEnd={`url(#${edgeMarkerId(markerVariant)})`} style={edgeStyle} />
      </g>
      {showLabel ? (
        <EdgeLabelRenderer>
          <div
            className={styles.label}
            data-edge-label={id}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              color: `var(${visual.varName})`,
              opacity: dimmed ? DIMMED_OPACITY_FACTOR : 1,
              transition: "opacity var(--dur-fast) var(--ease-standard)",
            }}
          >
            {labelText}
          </div>
        </EdgeLabelRenderer>
      ) : null}
      {bendable ? (
        <foreignObject
          className={styles.bendHandleRegion}
          x={handlePoint.x - 18}
          y={handlePoint.y - 18}
          width={36}
          height={36}
        >
          <button
            type="button"
            className={styles.bendHandle}
            data-edge-bend-handle={id}
            data-active={dragging}
            data-snapped={activeBend?.snap !== null && activeBend?.snap !== undefined}
            style={{ color: `var(${visual.varName})` }}
            aria-label={`Bend edge ${id}`}
            title={activeBend?.snap === "source-x" || activeBend?.snap === "target-x"
              ? "Snapped to a 90-degree corner; drag to adjust"
              : "Drag to bend; move near a corner to snap"}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.setPointerCapture?.(event.pointerId);
              setDraggingForKey(data.bendResetKey);
            }}
            onPointerMove={handleBendMove}
            onPointerUp={(event) => {
              event.stopPropagation();
              event.currentTarget.releasePointerCapture?.(event.pointerId);
              setDraggingForKey(null);
            }}
            onPointerCancel={() => setDraggingForKey(null)}
          />
        </foreignObject>
      ) : null}
    </>
  );
}
