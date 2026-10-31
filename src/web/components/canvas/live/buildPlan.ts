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

/** Every card takes the same time, so a big build takes longer instead of rushing each card. */
const CARD_MS = 1050;
/** A short card-to-card edge takes EDGE_MS. A longer edge takes longer, by the square root of its
 * length, so the cursor does not race along it; EDGE_MAX_MS caps the longest ones. */
const EDGE_MS = 450;
const EDGE_REFERENCE_PX = 124;
const EDGE_MAX_MS = 2000;
/** One more cursor for every this many new cards, up to MAX_CURSORS. */
const CARDS_PER_CURSOR = 4;
const MAX_CURSORS = 4;
const CURSOR_STAGGER_MS = 150;
/** The pen-up move from a finished card to the start of an edge it draws next. */
const PEN_MOVE_MS = 250;

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
  const cardPhase = CARD_MS;

  /** How long an edge takes to draw. Its length is estimated as the horizontal plus the vertical
   * distance between the facing sides, because the real path is drawn only after this plan. */
  const edgeTime = (source: string, target: string): number => {
    const [leave, enter] = facingSides(boxes.get(source)!, boxes.get(target)!);
    const a = sidePoint(boxes.get(source)!, leave);
    const b = sidePoint(boxes.get(target)!, enter);
    const length = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    return Math.min(EDGE_MAX_MS, EDGE_MS * Math.sqrt(Math.max(1, length / EDGE_REFERENCE_PX)));
  };

  const laneOf = new Map<string, number>();
  const indexOf = new Map<string, number>();
  lanes.forEach((lane, laneIndex) => lane.forEach((nodeId, index) => {
    laneOf.set(nodeId, laneIndex);
    indexOf.set(nodeId, index);
  }));

  // The edge each new card's cursor rides in on: one from an old card, or from an earlier card in
  // the same run.
  const ridden = new Map<string, string>();
  for (const nodeId of added) {
    const incoming = layout.edges.find((edge) => {
      if (edge.target !== nodeId || edge.source === nodeId || !newEdges.includes(edge)) {
        return false;
      }
      const sourceLane = laneOf.get(edge.source);
      return sourceLane === undefined || (sourceLane === laneOf.get(nodeId) && indexOf.get(edge.source)! < indexOf.get(nodeId)!);
    });
    if (incoming !== undefined) {
      ridden.set(nodeId, incoming.id);
    }
  }
  const riddenIds = new Set(ridden.values());

  const edgeById = new Map(layout.edges.map((edge) => [edge.id, edge]));
  const leadIn = new Map(added.map((nodeId) => {
    const edge = edgeById.get(ridden.get(nodeId) ?? "");
    return [nodeId, edge === undefined ? EDGE_MS : edgeTime(edge.source, nodeId)];
  }));

  // Every other new edge gets a pen too: the cursor that finishes the later of its two cards draws
  // it as its next step. A link between two old cards goes to the first cursor before its cards.
  type Step = { card: string } | { edge: (typeof layout.edges)[number] };
  const steps: Step[][] = lanes.map((lane) => lane.map((card) => ({ card })));
  if (steps.length === 0 && newEdges.length > 0) {
    steps.push([]);
  }
  const baseReady = new Map<string, number>();
  lanes.forEach((lane, laneIndex) => {
    let t = laneIndex * CURSOR_STAGGER_MS;
    for (const nodeId of lane) {
      baseReady.set(nodeId, t + leadIn.get(nodeId)! + cardPhase * CARD_PHASE.WEAVE);
      t += leadIn.get(nodeId)! + cardPhase;
    }
  });
  for (const edge of newEdges) {
    if (riddenIds.has(edge.id)) {
      continue;
    }
    const owner = [edge.source, edge.target]
      .filter((nodeId) => laneOf.has(nodeId))
      .sort((a, b) => baseReady.get(b)! - baseReady.get(a)!)[0];
    if (owner === undefined) {
      steps[0]!.unshift({ edge });
      continue;
    }
    const lane = steps[laneOf.get(owner)!]!;
    const after = lane.findIndex((step) => "card" in step && step.card === owner);
    let at = after + 1;
    while (at < lane.length && "edge" in lane[at]!) {
      at += 1;
    }
    lane.splice(at, 0, { edge });
  }

  // Times: an edge waits until both of its cards are on the canvas, which can depend on another
  // cursor's run, so repeat until no time changes.
  const slotStart = new Map<string, number>();
  const extraDraws = new Map<string, EdgeDraw>();
  const ready = new Map(baseReady);
  let laneEnd = 0;
  for (let pass = 0; pass < 20; pass += 1) {
    laneEnd = 0;
    let moved = false;
    steps.forEach((lane, laneIndex) => {
      let t = laneIndex * CURSOR_STAGGER_MS;
      let afterCard = false;
      for (const step of lane) {
        if ("card" in step) {
          slotStart.set(step.card, t);
          t += leadIn.get(step.card)! + cardPhase;
          const cardReady = t - cardPhase * (1 - CARD_PHASE.WEAVE);
          moved ||= ready.get(step.card) !== cardReady;
          ready.set(step.card, cardReady);
          afterCard = true;
        } else {
          const bothOn = Math.max(ready.get(step.edge.source) ?? 0, ready.get(step.edge.target) ?? 0);
          const delay = Math.max(t + (afterCard ? PEN_MOVE_MS : 0), bothOn);
          const duration = edgeTime(step.edge.source, step.edge.target);
          extraDraws.set(step.edge.id, { delay, duration });
          t = delay + duration;
          afterCard = false;
        }
      }
      laneEnd = Math.max(laneEnd, t);
    });
    if (!moved) {
      break;
    }
  }
  const cardStart = (nodeId: string) => slotStart.get(nodeId)! + leadIn.get(nodeId)!;

  const edges = new Map<string, EdgeDraw>(extraDraws);
  for (const edgeId of riddenIds) {
    const target = edgeById.get(edgeId)!.target;
    edges.set(edgeId, { delay: slotStart.get(target)!, duration: leadIn.get(target)! });
  }

  const cursors: CursorKey[][] = steps.map(() => []);
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

  steps.forEach((lane, laneIndex) => {
    for (const step of lane) {
      if ("edge" in step) {
        const { delay, duration } = extraDraws.get(step.edge.id)!;
        labels.push({ t: delay, text: "Connecting", cursor: laneIndex });
        rideEdge(laneIndex, step.edge.id, step.edge.source, step.edge.target, delay, duration);
        continue;
      }
      const nodeId = step.card;
      const box = boxes.get(nodeId)!;
      const start = slotStart.get(nodeId)!;
      const edgeId = ridden.get(nodeId);
      if (edgeId !== undefined) {
        const edge = edgeById.get(edgeId)!;
        rideEdge(laneIndex, edgeId, edge.source, nodeId, start, leadIn.get(nodeId)!);
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
  };
}
