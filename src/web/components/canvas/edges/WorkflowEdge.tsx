import { useCallback, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, getSmoothStepPath, Position, useNodesData, type EdgeProps } from "@xyflow/react";
import { categoryToken, connectionStyle, outcomeEdgeStyle, RETRY_EDGE_VISUAL } from "../../../design/semantics";
import { RETRY_IN_FRACTION, RETRY_OUT_FRACTION } from "../buildFlowElements";
import { connectionLabelText } from "../edgeLabel";
import type { CanvasFlowNode, WorkflowFlowEdge } from "../types";
import { edgeMarkerId } from "./EdgeMarkers";
import styles from "./WorkflowEdge.module.css";

/** Branches turn with a broad radius so they feel routed rather than mechanically elbowed. */
const EDGE_BORDER_RADIUS = 16;
const RETRY_LOOP_OUTSET = 80;
const RETRY_LABEL_LIFT = 12;
const RETRY_LABEL_INSET = 36;
const PARALLEL_EDGE_SPACING = 34;
const RETURN_EDGE_LIFT = 84;
const PARALLEL_ENDPOINT_LEAD = 18;
/** The last stretch of a default curve is a straight run along the target port, longer than the
 * 10px arrowhead. The marker is oriented by the path's final tangent, which a bezier always makes
 * port-aligned; but when source and target nearly line up across the port axis, the curve only
 * turns in its last few pixels and the visible line cuts through one of the arrowhead's arms. */
const ARROW_LEAD = 14;

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

/** The live build's ink easing (liveBuild.css `hqEdgeDraw`); the riding cursor uses it too. */
export const INK_EASING = "cubic-bezier(0.65, 0, 0.35, 1)";
/** The drop follows the edge through one point for every this many pixels, like the riding cursor. */
const INK_DROP_STEP_PX = 30;
const MIN_INK_DROP_SAMPLES = 24;

/**
 * The ink drop: a glowing bead that runs along the edge while its ink line draws in behind it,
 * swelling mid-way like a drop of ink. It runs on its ink line's clock: it wears the build's set
 * class, so AgentCursor moves it with the build, and a later restart copies the line's start time.
 */
function InkDrop({ id, set, path, delay, duration, color }: { id: string; set: string; path: string; delay: number; duration: number; color: string }) {
  const trackRef = useRef<SVGPathElement>(null);
  const dropRef = useRef<SVGCircleElement>(null);
  const mountedAt = useRef(0);
  useLayoutEffect(() => {
    const track = trackRef.current;
    const drop = dropRef.current;
    if (track === null || drop === null || typeof drop.animate !== "function" || typeof track.getTotalLength !== "function") {
      return;
    }
    if (mountedAt.current === 0) {
      mountedAt.current = performance.now();
    }
    const length = track.getTotalLength();
    const samples = Math.max(MIN_INK_DROP_SAMPLES, Math.ceil(length / INK_DROP_STEP_PX));
    const frames: Keyframe[] = [];
    for (let k = 0; k <= samples; k += 1) {
      const share = k / samples;
      const point = track.getPointAtLength(length * share);
      frames.push({
        offset: share,
        transform: `translate(${point.x}px, ${point.y}px) scale(${0.65 + 0.55 * Math.sin(share * Math.PI)})`,
        opacity: k === samples ? 0 : 1,
      });
    }
    const animation = drop.animate(frames, { duration, delay, easing: INK_EASING, fill: "forwards" });
    const ink = drop.ownerDocument
      .querySelector(`[data-edge-ink="${CSS.escape(id)}"]`)
      ?.getAnimations()
      .find((candidate) => candidate instanceof CSSAnimation && candidate.animationName === "hqEdgeDraw");
    if (ink?.startTime != null) {
      animation.startTime = ink.startTime;
    } else {
      // A re-render with a new path keeps the drop where it was in time instead of restarting it.
      animation.currentTime = performance.now() - mountedAt.current;
    }
    return () => animation.cancel();
  }, [delay, duration, id, path]);
  return (
    <g className={set} pointerEvents="none" aria-hidden="true">
      <path ref={trackRef} d={path} fill="none" stroke="none" />
      <circle ref={dropRef} r={4.5} style={{ fill: color, opacity: 0, filter: `drop-shadow(0 0 6px ${color})` }} />
    </g>
  );
}

/** The hand-off comet's constant speed, so short and long edges move the same. */
const COMET_SPEED = 150;
const COMET_REST = 700;
const COMET_TAIL = 8;
const COMET_TAIL_STEP = 3.1;
/** The comet fades in over the first and out over the last this share of its run. */
const COMET_FADE = 0.05;
/** A route that changes length by more than this share retimes the comet to keep its speed;
 * smaller changes, such as a card dragged a little, only move its route. */
const COMET_RETIME_SHARE = 0.25;

/** Where along the edge the comet switches from the source colour to the target colour: it
 * holds the source colour, crossfades over a short stretch, then holds the target colour, so the
 * last third of the run clearly reads as the next card. */
const COMET_SWITCH_START = 0.55;
const COMET_SWITCH_END = 0.62;

function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The hand-off comet: a bead in the source card's colour that switches to the target card's
 * colour part-way along, with a short tail that keeps the colour the bead had at each point. It
 * is cut out of the line (the parent masks the line with `maskId`), so it never melts into the
 * stroke.
 */
function HandoffComet({ path, maskId, from, to }: { path: string; maskId: string; from: string; to: string }) {
  const trackRef = useRef<SVGPathElement>(null);
  const headRef = useRef<SVGCircleElement>(null);
  const cutRef = useRef<SVGCircleElement>(null);
  const tailRefs = useRef<Array<SVGCircleElement | null>>([]);
  const run = useRef<{ animations: Animation[]; travel: number; from: string; to: string } | null>(null);
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (track === null || typeof track.getTotalLength !== "function") {
      return;
    }
    // The circles ride the route as a CSS motion path, so a dragged card only swaps the route:
    // the running animations keep their place, and nothing is sampled or rebuilt per move.
    const circles = [headRef.current, cutRef.current, ...tailRefs.current];
    circles.forEach((circle) => circle?.style.setProperty("offset-path", `path("${path}")`));
    const length = track.getTotalLength();
    const travel = (length / COMET_SPEED) * 1000;
    const previous = run.current;
    if (previous !== null && previous.from === from && previous.to === to
      && Math.abs(travel - previous.travel) <= previous.travel * COMET_RETIME_SHARE) {
      return;
    }

    const style = getComputedStyle(track);
    const resolve = (name: string): string => style.getPropertyValue(name).trim() || "currentColor";
    const fromColor = resolve(from);
    const toColor = resolve(to);
    const duration = travel + COMET_REST;
    const share = travel / duration;
    // Keyframes at the fade ends and across the colour switch; the motion between them is linear.
    const switchSteps = [0.25, 0.5, 0.75].map((t) => COMET_SWITCH_START + (COMET_SWITCH_END - COMET_SWITCH_START) * t);
    const stops = [0, COMET_FADE, COMET_SWITCH_START, ...switchSteps, COMET_SWITCH_END, 1 - COMET_FADE, 1];
    const frames = (peak: number, cut: boolean): Keyframe[] => [
      ...stops.map((s): Keyframe => {
        const fade = Math.max(0, Math.min(1, s / COMET_FADE, (1 - s) / COMET_FADE));
        return cut
          ? { offset: s * share, offsetDistance: `${s * 100}%`, transform: `scale(${fade})` }
          : {
              offset: s * share,
              offsetDistance: `${s * 100}%`,
              fill: s <= COMET_SWITCH_START
                ? fromColor
                : s >= COMET_SWITCH_END
                  ? toColor
                  : `color-mix(in oklch, ${toColor} ${Math.round(((s - COMET_SWITCH_START) / (COMET_SWITCH_END - COMET_SWITCH_START)) * 100)}%, ${fromColor})`,
              opacity: fade * peak,
            };
      }),
      cut ? { offset: 1, offsetDistance: "100%", transform: "scale(0)" } : { offset: 1, offsetDistance: "100%", opacity: 0 },
    ];
    const timing = { duration, iterations: Infinity, easing: "linear" } as const;
    const animations: Animation[] = [];
    if (headRef.current !== null) animations.push(headRef.current.animate(frames(1, false), timing));
    if (cutRef.current !== null) animations.push(cutRef.current.animate(frames(1, true), timing));
    tailRefs.current.forEach((circle, index) => {
      if (circle === null) return;
      const tailShare = 1 - (index + 1) / (COMET_TAIL + 1);
      const lag = ((index + 1) * COMET_TAIL_STEP / COMET_SPEED) * 1000;
      animations.push(circle.animate(frames(0.15 + 0.75 * tailShare, false), { ...timing, delay: lag }));
    });
    if (previous !== null) {
      // A much longer or shorter route changes the travel time. Keep the fraction already
      // travelled, or the elapsed rest, rather than restarting at the source.
      const time = Number(previous.animations[0]?.currentTime ?? 0);
      const previousDuration = previous.travel + COMET_REST;
      const cycle = Math.floor(time / previousDuration);
      const phase = time % previousDuration;
      const next = cycle * duration + (phase < previous.travel
        ? (phase / previous.travel) * travel
        : travel + phase - previous.travel);
      animations.forEach((animation) => { animation.currentTime = next; });
      previous.animations.forEach((animation) => animation.cancel());
    }
    run.current = { animations, travel, from, to };
  }, [path, from, to]);
  useLayoutEffect(() => () => {
    run.current?.animations.forEach((animation) => animation.cancel());
    run.current = null;
  }, []);
  return (
    <>
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x={-1e5} y={-1e5} width={2e5} height={2e5}>
          <rect x={-1e5} y={-1e5} width={2e5} height={2e5} fill="white" />
          <circle ref={cutRef} r={7} fill="black" style={{ transform: "scale(0)" }} />
        </mask>
      </defs>
      <g pointerEvents="none" aria-hidden="true" data-handoff-comet="">
        <path ref={trackRef} d={path} fill="none" stroke="none" />
        {Array.from({ length: COMET_TAIL }, (_, index) => (
          <circle
            key={index}
            ref={(circle) => { tailRefs.current[index] = circle; }}
            r={0.9 + 2.6 * (1 - (index + 1) / (COMET_TAIL + 1))}
            style={{ opacity: 0 }}
          />
        ))}
        <circle ref={headRef} r={4.2} style={{ opacity: 0, stroke: "var(--bg-raised)", strokeWidth: 1.4 }} />
      </g>
    </>
  );
}

/** Round real turns, not the redundant points a router inserts along a straight run. */
export function roundedPolylinePath(points: Array<{ x: number; y: number }>, radius = EDGE_BORDER_RADIUS): string {
  const turns: typeof points = [];
  for (const point of points) {
    const last = turns.at(-1);
    if (last?.x === point.x && last.y === point.y) continue;
    while (turns.length >= 2) {
      const a = turns[turns.length - 2]!;
      const b = turns[turns.length - 1]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const nextDx = point.x - b.x;
      const nextDy = point.y - b.y;
      // Keep reversals: removing them would cut across the route instead of simplifying it.
      if (dx * nextDy !== dy * nextDx || dx * nextDx + dy * nextDy < 0) break;
      turns.pop();
    }
    turns.push(point);
  }
  points = turns;
  let path = `M${points[0]!.x},${points[0]!.y}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const c = points[i + 1]!;
    if ((b.x - a.x) * (c.y - b.y) === (b.y - a.y) * (c.x - b.x)) {
      path += ` L${b.x},${b.y}`;
      continue;
    }
    const l1 = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const l2 = Math.hypot(c.x - b.x, c.y - b.y) || 1;
    const r = Math.min(radius, l1 / 2, l2 / 2);
    path += ` L${b.x + ((a.x - b.x) / l1) * r},${b.y + ((a.y - b.y) / l1) * r} Q${b.x},${b.y} ${b.x + ((c.x - b.x) / l2) * r},${b.y + ((c.y - b.y) / l2) * r}`;
  }
  const last = points[points.length - 1]!;
  return `${path} L${last.x},${last.y}`;
}

/** Wrap view: how far a row-turn edge runs out of its source and in front of its target. */
const TURN_LEAD = 24;

/** React Flow's bezier, ending on a straight `ARROW_LEAD` run so the arrowhead always sits on its own line. */
export function arrowSafeBezierPath(
  source: { x: number; y: number },
  sourcePosition: Position,
  target: { x: number; y: number },
  targetPosition: Position,
): [path: string, labelX: number, labelY: number] {
  const lead = portControlPoint(target, targetPosition, ARROW_LEAD);
  const [path, labelX, labelY] = getBezierPath({
    sourceX: source.x,
    sourceY: source.y,
    sourcePosition,
    targetX: lead.x,
    targetY: lead.y,
    targetPosition,
    curvature: 0.35,
  });
  return [`${path} L${target.x},${target.y}`, labelX, labelY];
}

function parallelEdgePath(
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
  const sourceLead = portControlPoint(source, sourcePosition, Math.min(PARALLEL_ENDPOINT_LEAD, sourceDistance / 3));
  const targetLead = portControlPoint(target, targetPosition, Math.min(PARALLEL_ENDPOINT_LEAD, targetDistance / 3));
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

/** Every connection uses one thin stroke, so the cards stay the figure and the edges step back.
 * Colour and dash pattern carry the connection type; path tracing still thickens traced edges. */
const EDGE_STROKE_WIDTH = 1.6;

const DASH_PATTERNS: Record<"dashed" | "dotted", string> = {
  dashed: "8 6",
  dotted: "1 6",
};

/** How much wider than the semantic stroke the background-coloured casing/halo paints — a thin
 * underlay that carves the line clear of the canvas grid, card borders, and crossing edges. Kept
 * small so it reads as separation, not as a glow around the thin line. The halo follows the same
 * path shape (dashes are preserved on the semantic stroke on top); only its width grows. */
const HALO_WIDTH_PADDING = 2;
/** The halo stops this far from the target, under the arrowhead, so its flat end never shows
 * beside the arrow's point. */
const HALO_TIP_CUT = 5;
/** How much a traced edge's stroke grows when path tracing is active (contract §11): tracing must
 * not only dim unrelated paths, it must also strengthen the path the user is following, so the
 * traced line reads as the figure rather than merely the ground. Kept under the next weight tier
 * so hierarchy is reinforced, not flattened. */
const TRACED_STROKE_BOOST = 1;
/** Opacity applied to a dimmed edge during path tracing (contract §11) — a dimmed edge fades to a
 * quiet background tone while traced edges strengthen, so the followed path reads as the figure. */
const DIMMED_OPACITY_FACTOR = 0.25;
/** Success, async, conditional, and retry edges carry the hand-off comet while a trace is active.
 * Failure and terminal-outcome edges stay still so a hard stop does not look like flow. */
function edgeCarriesTravelingOrb(variant: string | undefined): boolean {
  return variant === "success" || variant === "async" || variant === "conditional" || variant === "retry" || variant === undefined;
}

/**
 * A directional connector styled from the connection type or terminal outcome band: neutral solid
 * for success/default, green dashed for a successful terminal, muted red dashed for failure, amber
 * dashed for conditional, and neutral dotted for async. Geometry is derived from React Flow's live
 * handle coordinates, so every path remains attached while a card is dragged.
 */
export function WorkflowEdge({ id, data, source, target, sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition }: EdgeProps<WorkflowFlowEdge>) {
  const endpoints = useNodesData<CanvasFlowNode>([source, target]);
  const maskBaseId = `codehq-label-gap${useId()}`;
  // The label's laid-out size in flow units (the label renderer sits inside the viewport
  // transform), so the line can stop at the word and continue after it.
  const [labelSize, setLabelSize] = useState<{ width: number; height: number } | null>(null);
  const labelRef = useCallback((label: HTMLElement | null) => {
    if (label === null || typeof ResizeObserver === "undefined") {
      setLabelSize(null);
      return undefined;
    }
    const observer = new ResizeObserver(() => {
      const width = label.offsetWidth;
      const height = label.offsetHeight;
      setLabelSize((current) => (
        width === 0 || height === 0
          ? null
          : current?.width === width && current.height === height ? current : { width, height }
      ));
    });
    observer.observe(label);
    return () => observer.disconnect();
  }, []);

  if (data === undefined) {
    return null;
  }

  const { connection, retry = false, returnEdge = false, branch = false, outcomeBand, dimmed, traced } = data;
  const { turnY, returnX } = data;
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
    // Over the card's top-right corner, not at the curl's apex: the gap beside the card is where
    // outgoing connections (and their fanned-out labels) run. The retry handles sit at fixed
    // fractions of the card's height, so the card's top edge follows from them.
    const cardHeight = Math.abs(sourceY - targetY) / (RETRY_OUT_FRACTION - RETRY_IN_FRACTION);
    labelX = Math.max(sourceX, targetX) - RETRY_LABEL_INSET;
    labelY = Math.min(sourceY, targetY) - cardHeight * RETRY_IN_FRACTION - RETRY_LABEL_LIFT;
  } else if (returnEdge && returnX !== undefined) {
    path = roundedPolylinePath([{ x: sourceX, y: sourceY }, { x: returnX, y: sourceY }, { x: returnX, y: targetY }, { x: targetX, y: targetY }]);
    labelX = returnX;
    labelY = (sourceY + targetY) / 2;
  } else if (turnY !== undefined) {
    const outX = sourceX + TURN_LEAD;
    const inX = targetX - TURN_LEAD;
    path = roundedPolylinePath([
      { x: sourceX, y: sourceY },
      { x: outX, y: sourceY },
      { x: outX, y: turnY },
      { x: inX, y: turnY },
      { x: inX, y: targetY },
      { x: targetX, y: targetY },
    ]);
    labelX = (outX + inX) / 2;
    labelY = turnY;
  } else if (returnEdge) {
    const liftY = Math.min(sourceY, targetY) - RETURN_EDGE_LIFT;
    path = `M${sourceX},${sourceY} C${sourceX},${liftY} ${targetX},${liftY} ${targetX},${targetY}`;
    labelX = (sourceX + targetX) / 2;
    labelY = liftY;
  } else {
    if (branch || data.routing === "step") {
      const facingGap = sourcePosition === Position.Right && targetPosition === Position.Left ? targetX - sourceX
        : sourcePosition === Position.Left && targetPosition === Position.Right ? sourceX - targetX
          : sourcePosition === Position.Bottom && targetPosition === Position.Top ? targetY - sourceY
            : sourcePosition === Position.Top && targetPosition === Position.Bottom ? sourceY - targetY : 0;
      [path, labelX, labelY] = getSmoothStepPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
        // Get the orthogonal route first; apply rounding after removing straight-run points.
        borderRadius: 0,
        // Keep the leads apart, even with fractional coordinates, to avoid a backwards kink.
        offset: facingGap > 0 ? Math.min(28, facingGap / 4) : 28,
      });
      // At radius zero, each Q control point equals its endpoint. M/L/Q endpoints therefore
      // describe the original polyline without needing to approximate or sample the path.
      path = roundedPolylinePath([...path.matchAll(/[MLQ]([^MLQ]+)/g)].map((match) => {
        const coordinates = match[1]!.trim().split(/[\s,]+/).map(Number);
        return { x: coordinates.at(-2)!, y: coordinates.at(-1)! };
      }));
    } else {
      [path, labelX, labelY] = arrowSafeBezierPath({ x: sourceX, y: sourceY }, sourcePosition, { x: targetX, y: targetY }, targetPosition);
    }
    const parallelOffset = data.parallelOffset ?? 0;
    if (parallelOffset !== 0) {
      const length = Math.hypot(targetX - sourceX, targetY - sourceY) || 1;
      const spread = parallelOffset * PARALLEL_EDGE_SPACING;
      const fanPoint = {
        x: (sourceX + targetX) / 2 - ((targetY - sourceY) / length) * spread,
        y: (sourceY + targetY) / 2 + ((targetX - sourceX) / length) * spread,
      };
      path = parallelEdgePath({ x: sourceX, y: sourceY }, sourcePosition, fanPoint, { x: targetX, y: targetY }, targetPosition);
      labelX = fanPoint.x;
      labelY = fanPoint.y;
    }
  }

  const strokeWidth = EDGE_STROKE_WIDTH + (traced ? TRACED_STROKE_BOOST : 0);
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
    stroke: "var(--edge-halo)",
    strokeWidth: strokeWidth + HALO_WIDTH_PADDING,
    opacity,
    transition: edgeTransition,
    pointerEvents: "none",
  };

  const labelText = isRetryLoop ? (connectionLabelText(connection) ?? "retry") : connectionLabelText(connection);
  const showLabel = labelText !== undefined;
  const showTravelingOrb = !dimmed && edgeCarriesTravelingOrb(markerVariant);
  const cometActive = showTravelingOrb && traced && !prefersReducedMotion();
  const cometMaskId = `${maskBaseId}-comet-${id}`.replace(/[^\w-]/g, "_");
  const categoryVar = (nodeId: string): string => categoryToken(endpoints.find((node) => node.id === nodeId)?.data.step.category).varName;
  const build = data.build;
  const buildTiming = build !== undefined
    ? ({ "--hq-delay": `${build.delay}ms`, "--hq-dur": `${build.duration}ms` } as CSSProperties)
    : undefined;

  // Text-only labels: the line stops at the word and continues after it. The gap is a mask cut the
  // size of the label box, so the halo, the line, and the live-build ink all break around it.
  const labelGap = showLabel && labelSize !== null ? labelSize : null;
  const gapMaskId = `${maskBaseId}-${id}`.replace(/[^\w-]/g, "_");
  const gapMask = labelGap !== null ? `url(#${gapMaskId})` : undefined;
  const labelStyle: CSSProperties = {
    ...buildTiming,
    transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
    color: `var(${visual.varName})`,
    opacity: dimmed ? DIMMED_OPACITY_FACTOR : 1,
    transition: "opacity var(--dur-fast) var(--ease-standard)",
  };
  const labelClassName = [
    styles.label,
    "nodrag nopan",
    build !== undefined ? `hq-edge-build ${build.set}` : "",
  ].filter(Boolean).join(" ");

  const haloMaskId = `${maskBaseId}-halo-${id}`.replace(/[^\w-]/g, "_");

  return (
    <>
      <defs>
        <mask id={haloMaskId} maskUnits="userSpaceOnUse" x={-1e5} y={-1e5} width={2e5} height={2e5}>
          <rect x={-1e5} y={-1e5} width={2e5} height={2e5} fill="white" />
          <circle cx={targetX} cy={targetY} r={HALO_TIP_CUT} fill="black" />
        </mask>
      </defs>
      {labelGap !== null ? (
        <defs>
          <mask id={gapMaskId} maskUnits="userSpaceOnUse" x={-1e5} y={-1e5} width={2e5} height={2e5}>
            <rect x={-1e5} y={-1e5} width={2e5} height={2e5} fill="white" />
            <rect
              x={labelX - labelGap.width / 2}
              y={labelY - labelGap.height / 2}
              width={labelGap.width}
              height={labelGap.height}
              rx={3}
              fill="black"
            />
          </mask>
        </defs>
      ) : null}
      <g
        data-workflow-edge={id}
        data-edge-kind={markerVariant ?? "success"}
        data-edge-source={source}
        data-edge-target={target}
        data-traveling-orb={showTravelingOrb ? "true" : undefined}
        data-orb-active={cometActive ? "true" : undefined}
        className={[build !== undefined ? `hq-edge-build ${build.set}` : ""].filter(Boolean).join(" ") || undefined}
        style={buildTiming}
      >
        <g mask={gapMask}>
          <g mask={cometActive ? `url(#${cometMaskId})` : undefined}>
            <path d={path} fill="none" data-edge-halo="" mask={`url(#${haloMaskId})`} style={haloStyle} />
            <BaseEdge path={path} markerEnd={`url(#${edgeMarkerId(markerVariant)})`} style={edgeStyle} />
          </g>
          {cometActive ? <HandoffComet path={path} maskId={cometMaskId} from={categoryVar(source)} to={categoryVar(target)} /> : null}
        </g>
      </g>
      {build !== undefined ? (
        <path
          d={path}
          pathLength={1}
          className={`hq-edge-ink ${build.set}`}
          data-edge-ink={id}
          mask={gapMask}
          style={{ ...buildTiming, stroke: `var(${visual.varName})`, color: `var(${visual.varName})`, strokeWidth: strokeWidth + 1 }}
        />
      ) : null}
      {build !== undefined ? <InkDrop id={id} set={build.set} path={path} delay={build.delay} duration={build.duration} color={`var(${visual.varName})`} /> : null}
      {showLabel ? (
        <EdgeLabelRenderer>
          <div
            ref={labelRef}
            className={`${labelClassName} ${styles.labelHoverable}`}
            data-edge-label={id}
            data-edge-kind={markerVariant ?? "success"}
            title={labelText}
            style={labelStyle}
          >
            {labelText}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
