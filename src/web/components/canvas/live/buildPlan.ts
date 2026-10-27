import type { Workflow, WorkflowConnection } from "@schema/workflow";
import type { LayoutResult } from "../layout";

/**
 * The choreography for a live update: which cards and edges are new, when each one is drawn, and
 * the paths the agent cursors follow while drawing them. Pure data, in milliseconds from the moment
 * the update lands, and in canvas (flow) coordinates.
 *
 * New cards are taken in reading order and split into runs of neighbours, one run per cursor, so a
 * big build draws in several places at once. For each card its cursor first rides the edge that
 * leads in from a card already on the canvas (the ink drop), then drags a marquee in the card's
 * shape and weaves the card into it. When every run is done, the cursors draw the edges that join
 * their runs together.
 */

export interface NodeDraw {
  /** When the marquee starts. */
  delay: number;
  /** How long the whole card takes: marquee, weave, and the border closing. */
  duration: number;
}

export interface EdgeDraw {
  delay: number;
  duration: number;
}

export interface CursorKey {
  t: number;
  x: number;
  y: number;
  /** From this key to the next one, the cursor rides this edge's drawn path. */
  edge?: string;
}

/** What the weave needs to fly tiles into a card. */
export interface CardDraw extends NodeDraw {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  accent: string;
  outcome: boolean;
}

export interface BuildPlan {
  id: number;
  nodes: Map<string, NodeDraw>;
  edges: Map<string, EdgeDraw>;
  changed: Set<string>;
  cards: CardDraw[];
  /** One key path per cursor. */
  cursors: CursorKey[][];
  labels: Array<{ t: number; text: string; cursor: number }>;
  /** Centres of new cards, for the scene ripple, timed to when each one appears. */
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

/**
 * The card's phases, as fractions of its duration. liveBuild.css repeats these numbers.
 *   0      → MOVE   the cursor goes to the card's top-left corner
 *   MOVE   → DRAG   it drags the marquee to the bottom-right corner
 *   DRAG   → HOP    it hops to the right side
 *   HOP    → WEAVE  it sweeps back to the left; tiles fly off its tip into place
 *   WEAVE  → 1      the dashes close into the card's border and the card appears
 */
export const CARD_PHASE = { MOVE: 0.08, DRAG: 0.42, HOP: 0.46, WEAVE: 0.9 } as const;
/** How far the weave sweep swings up and down, as a share of the card's height. */
export const WEAVE_SWING = 0.32;
const WEAVE_SAMPLES = 12;

/** A full build lands in a few seconds however many cards arrive at once. */
const BUILD_BUDGET_MS = 5600;
const MIN_SLOT_MS = 560;
const MAX_SLOT_MS = 1500;
const EDGE_SHARE = 0.3;
/** One more cursor for every this many new cards, up to MAX_CURSORS. */
const CARDS_PER_CURSOR = 4;
const MAX_CURSORS = 4;
const CURSOR_STAGGER_MS = 150;
const JOIN_GAP_MS = 80;

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
      return { x: box.x, y: c.y };
    case "right":
      return { x: box.x + box.width, y: c.y };
    case "top":
      return { x: c.x, y: box.y };
    case "bottom":
      return { x: c.x, y: box.y + box.height };
  }
}

/** Splits `ids` into `count` runs of neighbours, as even as possible. */
function runs(ids: string[], count: number): string[][] {
  const result: string[][] = [];
  let first = 0;
  for (let i = 0; i < count; i += 1) {
    const size = Math.ceil((ids.length - first) / (count - i));
    result.push(ids.slice(first, first + size));
    first += size;
  }
  return result.filter((run) => run.length > 0);
}

/**
 * Plans the build from `previous` to `next`. `previous === null` replays the whole map from an
 * empty canvas. Returns `null` when nothing visible changed (for example, a snapshot that only
 * re-checked source files). `accentOf` gives each card's colour for its marquee and tiles.
 */
export function planBuild(
  previous: Workflow | null,
  next: Workflow,
  layout: LayoutResult,
  positionOf: (id: string) => { x: number; y: number } | undefined,
  id: number,
  accentOf: (id: string) => string = () => "var(--focus-ring)",
): BuildPlan | null {
  const before = new Map(previous?.steps.map((step) => [step.id, JSON.stringify(step)]) ?? []);
  const beforeConnections = new Set(previous?.connections.map(connectionKey) ?? []);
  const outcomes = new Set(layout.nodes.filter((node) => node.isOutcome).map((node) => node.id));
  const boxes = new Map<string, Box>(
    layout.nodes.map((node) => {
      const position = positionOf(node.id) ?? { x: node.x, y: node.y };
      return [node.id, { ...position, width: node.width, height: node.height }];
    }),
  );

  // Reading order: Flow reads down the page, the other views across it.
  const byRow = (a: Box, b: Box) => a.y - b.y || a.x - b.x;
  const byColumn = (a: Box, b: Box) => a.x - b.x || a.y - b.y;
  const order = layout.view === "line" ? byColumn : byRow;
  const added = layout.nodes
    .filter((node) => !before.has(node.id))
    .map((node) => node.id)
    .sort((a, b) => order(boxes.get(a)!, boxes.get(b)!));
  const changed = new Set(
    next.steps.filter((step) => before.has(step.id) && before.get(step.id) !== JSON.stringify(step)).map((step) => step.id),
  );
  const newEdges = layout.edges.filter(
    (edge) => !before.has(edge.source) || !before.has(edge.target) || !beforeConnections.has(connectionKey(edge.connection)),
  );
  if (added.length === 0 && changed.size === 0 && newEdges.length === 0) {
    return null;
  }

  const cursorCount = Math.min(MAX_CURSORS, Math.max(1, Math.ceil(added.length / CARDS_PER_CURSOR)));
  const lanes = runs(added, cursorCount);
  const perLane = Math.max(1, ...lanes.map((lane) => lane.length));
  const slot = Math.min(MAX_SLOT_MS, Math.max(MIN_SLOT_MS, BUILD_BUDGET_MS / perLane));
  const edgePhase = slot * EDGE_SHARE;
  const cardPhase = slot - edgePhase;

  const laneOf = new Map<string, number>();
  const slotStart = new Map<string, number>();
  lanes.forEach((lane, laneIndex) => lane.forEach((nodeId, index) => {
    laneOf.set(nodeId, laneIndex);
    slotStart.set(nodeId, laneIndex * CURSOR_STAGGER_MS + index * slot);
  }));
  const cardStart = (nodeId: string) => slotStart.get(nodeId)! + edgePhase;
  /** When a card is on the canvas: at once for old cards, when the border closes for new ones. */
  const readyAt = (nodeId: string) => (slotStart.has(nodeId) ? cardStart(nodeId) + cardPhase * CARD_PHASE.WEAVE : 0);
  const laneEnd = Math.max(0, ...lanes.map((lane, laneIndex) => laneIndex * CURSOR_STAGGER_MS + lane.length * slot));

  // The edge each new card's cursor rides in on: one from an old card, or from an earlier card in
  // the same run.
  const ridden = new Map<string, string>();
  for (const nodeId of added) {
    const incoming = layout.edges.find((edge) => {
      if (edge.target !== nodeId || edge.source === nodeId || !newEdges.includes(edge)) {
        return false;
      }
      const sourceLane = laneOf.get(edge.source);
      return sourceLane === undefined || (sourceLane === laneOf.get(nodeId) && slotStart.get(edge.source)! < slotStart.get(nodeId)!);
    });
    if (incoming !== undefined) {
      ridden.set(nodeId, incoming.id);
    }
  }
  const riddenIds = new Set(ridden.values());

  const edges = new Map<string, EdgeDraw>();
  // Edges that link two runs are drawn last, by the cursor whose run they leave from.
  const joins: Array<Array<(typeof layout.edges)[number]>> = lanes.map(() => []);
  for (const edge of newEdges) {
    const sourceLane = laneOf.get(edge.source);
    const targetLane = laneOf.get(edge.target);
    if (riddenIds.has(edge.id)) {
      edges.set(edge.id, { delay: slotStart.get(edge.target)!, duration: edgePhase });
    } else if (sourceLane !== undefined && targetLane !== undefined && sourceLane !== targetLane && edge.source !== edge.target) {
      joins[sourceLane]!.push(edge);
    } else if (sourceLane === undefined && targetLane === undefined) {
      // A new link between two old cards: drawn once the runs are done.
      edges.set(edge.id, { delay: laneEnd, duration: edgePhase });
    } else {
      // Fan-ins, outcomes, retries: drawn on their own once both ends are on the canvas.
      edges.set(edge.id, { delay: Math.max(readyAt(edge.source), readyAt(edge.target)), duration: edgePhase });
    }
  }

  const cursors: CursorKey[][] = lanes.map(() => []);
  const labels: BuildPlan["labels"] = [];
  const cards: CardDraw[] = [];
  const nodes = new Map<string, NodeDraw>();
  const stepName = new Map(next.steps.map((step) => [step.id, step.name]));
  const push = (lane: number, key: CursorKey) => {
    const keys = cursors[lane]!;
    const last = keys[keys.length - 1];
    keys.push({ ...key, t: last !== undefined ? Math.max(key.t, last.t + 1) : key.t });
  };
  const rideEdge = (lane: number, edgeId: string, source: string, target: string, delay: number, duration: number) => {
    const [leave, enter] = facingSides(boxes.get(source)!, boxes.get(target)!);
    push(lane, { t: delay, ...sidePoint(boxes.get(source)!, leave), edge: edgeId });
    push(lane, { t: delay + duration, ...sidePoint(boxes.get(target)!, enter) });
  };

  lanes.forEach((lane, laneIndex) => {
    for (const nodeId of lane) {
      const box = boxes.get(nodeId)!;
      const start = slotStart.get(nodeId)!;
      const edgeId = ridden.get(nodeId);
      if (edgeId !== undefined) {
        const edge = layout.edges.find((candidate) => candidate.id === edgeId)!;
        rideEdge(laneIndex, edgeId, edge.source, nodeId, start, edgePhase);
      }
      const delay = cardStart(nodeId);
      const at = (share: number) => delay + cardPhase * share;
      const middle = box.y + box.height / 2;
      push(laneIndex, { t: at(CARD_PHASE.MOVE), x: box.x, y: box.y });
      push(laneIndex, { t: at(CARD_PHASE.DRAG), x: box.x + box.width, y: box.y + box.height });
      push(laneIndex, { t: at(CARD_PHASE.HOP), x: box.x + box.width, y: middle });
      for (let k = 1; k <= WEAVE_SAMPLES; k += 1) {
        const u = k / WEAVE_SAMPLES;
        push(laneIndex, {
          t: at(CARD_PHASE.HOP + (CARD_PHASE.WEAVE - CARD_PHASE.HOP) * u),
          x: box.x + box.width * (1 - u),
          y: middle + Math.sin(u * Math.PI * 3) * box.height * WEAVE_SWING,
        });
      }
      nodes.set(nodeId, { delay, duration: cardPhase });
      cards.push({ id: nodeId, ...box, delay, duration: cardPhase, accent: accentOf(nodeId), outcome: outcomes.has(nodeId) });
      labels.push({ t: start, text: stepName.get(nodeId) ?? nodeId, cursor: laneIndex });
    }
  });

  joins.forEach((list, laneIndex) => {
    list.forEach((edge, index) => {
      const delay = laneEnd + index * (edgePhase + JOIN_GAP_MS);
      edges.set(edge.id, { delay, duration: edgePhase });
      if (index === 0) {
        labels.push({ t: delay, text: "Connecting", cursor: laneIndex });
      }
      rideEdge(laneIndex, edge.id, edge.source, edge.target, delay, edgePhase);
    });
  });

  const lastEdge = Math.max(0, ...[...edges.values()].map((edge) => edge.delay + edge.duration));
  return {
    id,
    nodes,
    edges,
    changed,
    cards,
    cursors: cursors.filter((keys) => keys.length > 0),
    labels,
    total: Math.max(lastEdge, laneEnd, changed.size > 0 ? 1200 : 0),
    added: next.steps.filter((step) => !before.has(step.id)).length,
    connections: newEdges.length,
  };
}
