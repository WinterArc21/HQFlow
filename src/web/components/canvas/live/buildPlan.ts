import type { Workflow, WorkflowConnection } from "@schema/workflow";
import type { LayoutResult } from "../layout";

/**
 * The choreography for a live update: which cards and edges are new, when each one is drawn, and
 * the path the agent cursor follows while drawing them. Pure data, in milliseconds from the moment
 * the update lands, and in canvas (flow) coordinates.
 *
 * New cards are drawn in reading order (left to right, then top to bottom). Each gets a slot: the
 * cursor first inks the edge that leads into the card from something already drawn, then traces
 * the card's outline starting from where that edge arrived, and the card fills in behind it.
 */

export interface NodeDraw {
  /** When the outline starts tracing. */
  delay: number;
  /** How long the outline takes to close. */
  duration: number;
  /** Where the outline starts, as a CSS conic angle: 0deg is up, clockwise. */
  from: number;
}

export interface EdgeDraw {
  delay: number;
  duration: number;
}

export interface CursorKey {
  t: number;
  x: number;
  y: number;
}

export interface BuildPlan {
  id: number;
  nodes: Map<string, NodeDraw>;
  edges: Map<string, EdgeDraw>;
  changed: Set<string>;
  cursor: CursorKey[];
  labels: Array<{ t: number; text: string }>;
  /** Centres of new cards, for the scene ripple, timed to when each one starts drawing. */
  pulses: CursorKey[];
  total: number;
  added: number;
  connections: number;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Side = "left" | "right" | "top" | "bottom";

const SIDE_ANGLE: Record<Side, number> = { top: 0, right: 90, bottom: 180, left: 270 };
/** The outline is traced a few pixels outside the card, where the drawing ring sits. */
const RING_OUTSET = 4;
const PERIMETER_SAMPLES = 24;
/** The whole build should land in a few seconds however many cards arrive at once. */
const BUILD_BUDGET_MS = 5600;
const MIN_SLOT_MS = 420;
const MAX_SLOT_MS = 1000;
const EDGE_SHARE = 0.4;
const TRACE_SHARE = 0.85;

function connectionKey(connection: WorkflowConnection): string {
  return [connection.from, connection.to, connection.type ?? "", connection.label ?? ""].join("\u0000");
}

function centre(box: Box): { x: number; y: number } {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The sides of `from` and `to` that face each other. */
function facingSides(from: Box, to: Box): [Side, Side] {
  const a = centre(from);
  const b = centre(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? ["right", "left"] : ["left", "right"];
  }
  return dy >= 0 ? ["bottom", "top"] : ["top", "bottom"];
}

function sidePoint(box: Box, side: Side): { x: number; y: number } {
  const c = centre(box);
  switch (side) {
    case "left":
      return { x: box.x - RING_OUTSET, y: c.y };
    case "right":
      return { x: box.x + box.width + RING_OUTSET, y: c.y };
    case "top":
      return { x: c.x, y: box.y - RING_OUTSET };
    case "bottom":
      return { x: c.x, y: box.y + box.height + RING_OUTSET };
  }
}

/** Where a ray from the card's centre at `angle` (0deg up, clockwise) leaves its ring. */
export function ringPoint(box: Box, angle: number): { x: number; y: number } {
  const c = centre(box);
  const radians = (angle * Math.PI) / 180;
  const dx = Math.sin(radians);
  const dy = -Math.cos(radians);
  const halfW = box.width / 2 + RING_OUTSET;
  const halfH = box.height / 2 + RING_OUTSET;
  const reach = Math.min(Math.abs(dx) < 1e-9 ? Infinity : halfW / Math.abs(dx), Math.abs(dy) < 1e-9 ? Infinity : halfH / Math.abs(dy));
  return { x: c.x + dx * reach, y: c.y + dy * reach };
}

/**
 * Plans the build from `previous` to `next`. `previous === null` replays the whole map from an
 * empty canvas. Returns `null` when nothing visible changed (for example, a snapshot that only
 * re-checked source files).
 */
export function planBuild(
  previous: Workflow | null,
  next: Workflow,
  layout: LayoutResult,
  positionOf: (id: string) => { x: number; y: number } | undefined,
  id: number,
): BuildPlan | null {
  const before = new Map(previous?.steps.map((step) => [step.id, JSON.stringify(step)]) ?? []);
  const beforeConnections = new Set(previous?.connections.map(connectionKey) ?? []);
  const boxes = new Map<string, Box>(
    layout.nodes.map((node) => {
      const position = positionOf(node.id) ?? { x: node.x, y: node.y };
      return [node.id, { ...position, width: node.width, height: node.height }];
    }),
  );

  const added = layout.nodes
    .filter((node) => !before.has(node.id))
    .map((node) => node.id)
    .sort((a, b) => boxes.get(a)!.x - boxes.get(b)!.x || boxes.get(a)!.y - boxes.get(b)!.y);
  const changed = new Set(
    next.steps.filter((step) => before.has(step.id) && before.get(step.id) !== JSON.stringify(step)).map((step) => step.id),
  );
  const newEdges = layout.edges.filter(
    (edge) => !before.has(edge.source) || !before.has(edge.target) || !beforeConnections.has(connectionKey(edge.connection)),
  );
  if (added.length === 0 && changed.size === 0 && newEdges.length === 0) {
    return null;
  }

  const slot = Math.min(MAX_SLOT_MS, Math.max(MIN_SLOT_MS, BUILD_BUDGET_MS / Math.max(1, added.length)));
  const edgePhase = slot * EDGE_SHARE;
  const tracePhase = (slot - edgePhase) * TRACE_SHARE;
  const order = new Map(added.map((nodeId, index) => [nodeId, index]));
  const slotOf = (nodeId: string) => order.get(nodeId) ?? -1;

  const edges = new Map<string, EdgeDraw>();
  for (const edge of newEdges) {
    const later = Math.max(slotOf(edge.source), slotOf(edge.target));
    // New links between cards that were already there are drawn after every new card.
    const start = later < 0
      ? added.length * slot
      : slotOf(edge.target) >= slotOf(edge.source) && edge.source !== edge.target
        ? later * slot
        : later * slot + edgePhase + tracePhase;
    edges.set(edge.id, { delay: start, duration: edgePhase });
  }

  const nodes = new Map<string, NodeDraw>();
  const cursor: CursorKey[] = [];
  const labels: BuildPlan["labels"] = [];
  const pulses: CursorKey[] = [];
  const stepName = new Map(next.steps.map((step) => [step.id, step.name]));
  const push = (t: number, point: { x: number; y: number }) => {
    const last = cursor[cursor.length - 1];
    cursor.push({ t: last !== undefined ? Math.max(t, last.t + 1) : t, ...point });
  };

  added.forEach((nodeId, index) => {
    const box = boxes.get(nodeId)!;
    const start = index * slot;
    // The edge the cursor draws into this card: one from a card that is already on the canvas.
    const incoming = layout.edges.find(
      (edge) => edge.target === nodeId && edge.source !== nodeId && slotOf(edge.source) < index && edges.has(edge.id),
    );
    let arrival: Side = "left";
    if (incoming !== undefined) {
      const sourceBox = boxes.get(incoming.source)!;
      const [leave, enter] = facingSides(sourceBox, box);
      arrival = enter;
      push(start, sidePoint(sourceBox, leave));
    }
    const from = SIDE_ANGLE[arrival];
    const traceStart = start + edgePhase;
    push(traceStart, sidePoint(box, arrival));
    for (let k = 1; k <= PERIMETER_SAMPLES; k += 1) {
      push(traceStart + (tracePhase * k) / PERIMETER_SAMPLES, ringPoint(box, from + (360 * k) / PERIMETER_SAMPLES));
    }
    nodes.set(nodeId, { delay: traceStart, duration: tracePhase, from });
    labels.push({ t: start, text: stepName.get(nodeId) ?? nodeId });
    pulses.push({ t: traceStart, ...centre(box) });
  });

  const lastEdge = Math.max(0, ...[...edges.values()].map((edge) => edge.delay + edge.duration));
  const lastNode = added.length * slot;
  return {
    id,
    nodes,
    edges,
    changed,
    cursor,
    labels,
    pulses,
    total: Math.max(lastEdge, lastNode, changed.size > 0 ? 1200 : 0),
    added: next.steps.filter((step) => !before.has(step.id)).length,
    connections: newEdges.length,
  };
}
