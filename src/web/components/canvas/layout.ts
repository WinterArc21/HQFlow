/** Deterministic horizontal workflow layout. Work reads left-to-right; terminal output steps
 * occupy semantic bands above (failure) or below (success) the vertically-centred mainline. */
import type { Workflow, WorkflowConnection } from "@schema/workflow";
import { outcomeTone } from "../../design/semantics";
import { connectionLabelText, estimateEdgeLabelWidth } from "./edgeLabel";
import { computeBackEdgeIds, computeOutcomeStepIds, computeTopologicalOrder } from "./graph";
import { computeNodeHeight, computeOutcomeNodeWidth, NODE_WIDTH, OUTCOME_NODE_HEIGHT } from "./nodeContent";

export const LAYOUT_RANK_SEP = 132;
export const LAYOUT_MARGIN_X = 48;
export const LAYOUT_MARGIN_Y = 48;
const OUTCOME_GAP = 30;
const FAILURE_TO_WORK_GAP = 128;
const WORK_LANE_GAP = 88;
const WORK_NODE_GAP = 52;
const WORK_TO_SUCCESS_GAP = 112;
const RETURN_EDGE_TOP_RESERVE = 112;
/** Flow: the gap between stages, between parallel cards, and between a card and its outcomes. */
const FLOW_ROW_GAP = 96;
const FLOW_COLUMN_GAP = 52;
const FLOW_OUTCOME_GAP = 44;
/** Space kept clear on each side of a label that sits in the gap beside a card. */
const FLOW_LABEL_CLEARANCE = 12;
/** Wrap: the gap between rows (the row-turn edge runs through its middle) and above an outcome band. */
export const WRAP_ROW_GAP = 104;
const WRAP_BAND_GAP = 52;

/**
 * How the map is arranged. `line` is the original horizontal layout. `flow` stacks stages top to
 * bottom with parallel steps side by side; `wrap` reads like a page: rows of stages, each left to
 * right, and the line returns under a row to the start of the next one.
 */
export type CanvasView = "flow" | "wrap" | "line";

export type OutcomeBand = "failure" | "success";

export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  index: number;
  isOutcome: boolean;
  outcomeBand?: OutcomeBand;
  /** Wrap view only: the row this node sits in. */
  row?: number;
}
export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
  connection: WorkflowConnection;
}
export interface LayoutBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}
export interface ComputeLayoutOptions {
  /** Defaults to `line`. */
  view?: CanvasView;
}
export interface LayoutResult {
  view: CanvasView;
  /** Wrap view only: the lowest edge of each row, so row-turn edges can run beneath it. */
  wrapRowBottoms?: number[];
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  bounds: LayoutBounds;
}

function edgeId(connection: WorkflowConnection, index: number): string {
  return connection.id ?? `${connection.from}->${connection.to}#${index}`;
}

function mainlinePriority(connection: WorkflowConnection): number {
  switch (connection.type) {
    case undefined:
    case "success":
      return 0;
    case "async":
      return 1;
    case "conditional":
      return 2;
    case "failure":
      return 3;
  }
}

export function computeLayout(workflow: Workflow, opts: ComputeLayoutOptions): LayoutResult {
  const ids = new Set(workflow.steps.map((step) => step.id));
  const valid = workflow.connections
    .map((connection, index) => ({ connection, index, id: edgeId(connection, index) }))
    .filter(({ connection }) => ids.has(connection.from) && ids.has(connection.to));
  const outcomes = computeOutcomeStepIds(workflow);
  const order = computeTopologicalOrder(workflow);
  const orderIndex = new Map(order.map((id, index) => [id, index] as const));
  const byId = new Map(workflow.steps.map((step, index) => [step.id, { step, index }] as const));
  const workIds = order.filter((id) => !outcomes.has(id));
  const workIdSet = new Set(workIds);
  const heights = new Map(
    workIds.map((id) => {
      const step = byId.get(id)!.step;
      return [id, computeNodeHeight(step)] as const;
    }),
  );
  const backEdgeIds = computeBackEdgeIds(workflow);
  const forwardWorkEdges = valid.filter(
    ({ connection, id }) =>
      workIdSet.has(connection.from) &&
      workIdSet.has(connection.to) &&
      connection.from !== connection.to &&
      !backEdgeIds.has(id),
  );

  // Horizontal ranks are graph-derived rather than declaration-order columns: true fan-outs
  // share an x rank, then rejoin farther right. Back edges are excluded so retry/return paths
  // cannot drag their targets backwards or create a rank cycle.
  const rankById = new Map<string, number>(workIds.map((id) => [id, 0]));
  if (forwardWorkEdges.length === 0) {
    workIds.forEach((id, index) => rankById.set(id, index));
  } else {
    for (const id of workIds) {
      const sourceRank = rankById.get(id) ?? 0;
      for (const { connection } of forwardWorkEdges) {
        if (connection.from === id) {
          rankById.set(connection.to, Math.max(rankById.get(connection.to) ?? 0, sourceRank + 1));
        }
      }
    }
    const connected = new Set(forwardWorkEdges.flatMap(({ connection }) => [connection.from, connection.to]));
    let nextIsolatedRank = Math.max(0, ...rankById.values()) + 1;
    for (const id of workIds) {
      if (!connected.has(id)) {
        rankById.set(id, nextIsolatedRank);
        nextIsolatedRank += 1;
      }
    }
  }

  // Pick one stable primary chain to own the horizontal centerline. At a fork, primary edges win,
  // then the longest remaining path, then declaration order. Other work remains graph-shaped in
  // lower lanes instead of being flattened into a list or mistaken for a terminal outcome.
  const longestFrom = new Map<string, number>();
  for (const id of [...workIds].reverse()) {
    const childLengths = forwardWorkEdges
      .filter(({ connection }) => connection.from === id)
      .map(({ connection }) => longestFrom.get(connection.to) ?? 1);
    longestFrom.set(id, 1 + Math.max(0, ...childLengths));
  }
  const mainline = new Set<string>();
  if (forwardWorkEdges.length === 0) {
    workIds.forEach((id) => mainline.add(id));
  } else {
    const incoming = new Set(forwardWorkEdges.map(({ connection }) => connection.to));
    const roots = workIds.filter((id) => !incoming.has(id));
    let current = (roots.length > 0 ? roots : workIds)
      .sort((a, b) =>
        (longestFrom.get(b) ?? 0) - (longestFrom.get(a) ?? 0) ||
        (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0),
      )[0];
    while (current !== undefined && !mainline.has(current)) {
      mainline.add(current);
      const next = forwardWorkEdges
        .filter(({ connection }) => connection.from === current && !mainline.has(connection.to))
        .sort((a, b) =>
          mainlinePriority(a.connection) - mainlinePriority(b.connection) ||
          (longestFrom.get(b.connection.to) ?? 0) - (longestFrom.get(a.connection.to) ?? 0) ||
          a.index - b.index,
        )[0];
      current = next?.connection.to;
    }
  }

  const bandForOutcome = (id: string): OutcomeBand => {
    const incomingTypes = valid
      .filter(({ connection }) => connection.to === id)
      .map(({ connection }) => connection.type);
    return outcomeTone(incomingTypes) === "failure" ? "failure" : "success";
  };
  const outcomeIds = workflow.steps.map((step) => step.id).filter((id) => outcomes.has(id));
  // An outcome sits beside the latest step that leads into it.
  const outcomeSource = (id: string): string | undefined => valid
    .filter(({ connection }) => connection.to === id && workIdSet.has(connection.from))
    .map(({ connection }) => connection.from)
    .sort((a, b) => (rankById.get(b) ?? 0) - (rankById.get(a) ?? 0) || (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0))[0];
  const outcomeWidth = (id: string): number => computeOutcomeNodeWidth(byId.get(id)!.step);
  const outcomeLabelWidth = (id: string): number => {
    const source = outcomeSource(id);
    const connection = valid.find(({ connection }) => connection.from === source && connection.to === id)?.connection;
    const text = connection === undefined ? undefined : connectionLabelText(connection);
    return text === undefined ? 0 : estimateEdgeLabelWidth(text);
  };
  const failureIds = outcomeIds.filter((id) => bandForOutcome(id) === "failure");
  const successIds = outcomeIds.filter((id) => bandForOutcome(id) === "success");
  const hasReturnEdge = valid.some(({ connection, id }) => backEdgeIds.has(id) && connection.from !== connection.to);
  const positioned = new Map<string, Placed>();
  let fallbackY = LAYOUT_MARGIN_Y;
  const view = opts.view ?? "line";
  let wrapRowBottoms: number[] | undefined;
  if (view === "flow") {
    placeFlow({ workIds, rankById, mainline, orderIndex, heights, outcomeIds, sourceOf: outcomeSource, widthOf: outcomeWidth, labelWidthOf: outcomeLabelWidth, positioned, band: bandForOutcome });
  } else if (view === "wrap") {
    wrapRowBottoms = placeWrap({ workIds, rankById, mainline, orderIndex, heights, outcomeIds, sourceOf: outcomeSource, widthOf: outcomeWidth, labelWidthOf: outcomeLabelWidth, positioned, band: bandForOutcome });
  } else {
    const failureY = LAYOUT_MARGIN_Y;
    const mainTopY = failureIds.length > 0
      ? failureY + OUTCOME_NODE_HEIGHT + FAILURE_TO_WORK_GAP
      : LAYOUT_MARGIN_Y + (hasReturnEdge ? RETURN_EDGE_TOP_RESERVE : 0);
    const maxMainlineHeight = Math.max(0, ...workIds.filter((id) => mainline.has(id)).map((id) => heights.get(id) ?? 0));
    const mainCenterY = mainTopY + maxMainlineHeight / 2;

    const maxRank = Math.max(-1, ...rankById.values());
    const xByRank = new Map<number, number>();
    let rankCursorX = LAYOUT_MARGIN_X;
    for (let rank = 0; rank <= maxRank; rank += 1) {
      xByRank.set(rank, rankCursorX);
      rankCursorX += NODE_WIDTH + LAYOUT_RANK_SEP;
    }
    for (let rank = 0; rank <= maxRank; rank += 1) {
      const idsAtRank = workIds
        .filter((id) => rankById.get(id) === rank)
        .sort((a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0));
      const onMainline = idsAtRank.filter((id) => mainline.has(id));
      const offMainline = idsAtRank.filter((id) => !mainline.has(id));
      for (const id of onMainline) {
        positioned.set(id, {
          x: xByRank.get(rank) ?? LAYOUT_MARGIN_X,
          y: mainCenterY - (heights.get(id) ?? 0) / 2,
        });
      }
      let laneY = mainCenterY + maxMainlineHeight / 2 + WORK_LANE_GAP;
      for (const id of offMainline) {
        positioned.set(id, { x: xByRank.get(rank) ?? LAYOUT_MARGIN_X, y: laneY });
        laneY += (heights.get(id) ?? 0) + WORK_NODE_GAP;
      }
    }

    const workBottom = Math.max(mainTopY, ...workIds.map((id) => {
      const point = positioned.get(id);
      return (point?.y ?? mainTopY) + (heights.get(id) ?? 0);
    }));

    const sourceAnchorX = (outcomeId: string): number => {
      const sourceCenters = valid
        .filter(({ connection }) => connection.to === outcomeId)
        .map(({ connection }) => {
          const source = positioned.get(connection.from);
          return source === undefined ? undefined : source.x + NODE_WIDTH / 2;
        })
        .filter((x): x is number => x !== undefined);
      return sourceCenters.length > 0
        ? sourceCenters.reduce((sum, x) => sum + x, 0) / sourceCenters.length
        : LAYOUT_MARGIN_X + NODE_WIDTH / 2;
    };

    const placeOutcomeBand = (bandIds: string[], bandName: OutcomeBand, y: number): void => {
      const band = [...bandIds].sort((a, b) =>
        sourceAnchorX(a) - sourceAnchorX(b) || byId.get(a)!.index - byId.get(b)!.index,
      );
      let cursor = -Infinity;
      for (const id of band) {
        const step = byId.get(id)!.step;
        const width = computeOutcomeNodeWidth(step);
        const x = Math.max(cursor, sourceAnchorX(id) - width / 2);
        positioned.set(id, { x, y, band: bandName });
        cursor = x + width + OUTCOME_GAP;
      }
    };
    placeOutcomeBand(failureIds, "failure", failureY);
    placeOutcomeBand(successIds, "success", workBottom + WORK_TO_SUCCESS_GAP);
    fallbackY = mainCenterY;
  }

  const nodes = workflow.steps.map((step, index): LayoutNode => {
    const isOutcome = outcomes.has(step.id);
    const height = isOutcome
      ? OUTCOME_NODE_HEIGHT
      : (heights.get(step.id) ?? computeNodeHeight(step));
    const point = positioned.get(step.id) ?? {
      x: LAYOUT_MARGIN_X + index * (NODE_WIDTH + LAYOUT_RANK_SEP),
      y: fallbackY - height / 2,
    };
    return {
      id: step.id,
      x: point.x,
      y: point.y,
      width: isOutcome ? computeOutcomeNodeWidth(step) : NODE_WIDTH,
      height,
      index,
      isOutcome,
      ...(isOutcome ? { outcomeBand: point.band ?? bandForOutcome(step.id) } : {}),
      ...(point.row !== undefined ? { row: point.row } : {}),
    };
  });
  const edges = valid.map(({ connection, index }) => ({
    id: edgeId(connection, index),
    source: connection.from,
    target: connection.to,
    connection,
  }));
  const shape = { view, ...(wrapRowBottoms !== undefined ? { wrapRowBottoms } : {}) };
  if (nodes.length === 0) {
    return { ...shape, nodes, edges, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 } };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }
  return { ...shape, nodes, edges, bounds: { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY } };
}

/**
 * The view a map opens in: `wrap` for a simple chain (every work step leads to at most one other
 * and is reached from at most one, with no loops back), `flow` for anything that branches.
 */
export function chooseCanvasView(workflow: Workflow): CanvasView {
  if (computeBackEdgeIds(workflow).size > 0) {
    return "flow";
  }
  const outcomes = computeOutcomeStepIds(workflow);
  const work = new Set(workflow.steps.map((step) => step.id).filter((id) => !outcomes.has(id)));
  const next = new Map<string, Set<string>>();
  const previous = new Map<string, Set<string>>();
  for (const { from, to } of workflow.connections) {
    if (work.has(from) && work.has(to)) {
      next.set(from, (next.get(from) ?? new Set()).add(to));
      previous.set(to, (previous.get(to) ?? new Set()).add(from));
    }
  }
  const branches = [...next.values(), ...previous.values()].some((ids) => ids.size > 1);
  return branches ? "flow" : "wrap";
}

interface Placed {
  x: number;
  y: number;
  band?: OutcomeBand;
  row?: number;
}

interface PlaceParams {
  workIds: string[];
  rankById: Map<string, number>;
  mainline: Set<string>;
  orderIndex: Map<string, number>;
  heights: Map<string, number>;
  outcomeIds: string[];
  sourceOf: (id: string) => string | undefined;
  widthOf: (id: string) => number;
  /** Width of the label on the connection into an outcome, or 0 when it has none. */
  labelWidthOf: (id: string) => number;
  positioned: Map<string, Placed>;
  band: (id: string) => OutcomeBand;
}

/** Work steps per stage, main chain first, then declaration order. */
function stageLists(p: PlaceParams): string[][] {
  const maxRank = Math.max(-1, ...p.rankById.values());
  const lists: string[][] = [];
  for (let rank = 0; rank <= maxRank; rank += 1) {
    const ids = p.workIds
      .filter((id) => p.rankById.get(id) === rank)
      .sort((a, b) => Number(p.mainline.has(b)) - Number(p.mainline.has(a)) || (p.orderIndex.get(a) ?? 0) - (p.orderIndex.get(b) ?? 0));
    if (ids.length > 0) {
      lists.push(ids);
    }
  }
  return lists;
}

function outcomesBySource(p: PlaceParams): { bySource: Map<string, string[]>; orphans: string[] } {
  const bySource = new Map<string, string[]>();
  const orphans: string[] = [];
  for (const id of p.outcomeIds) {
    const source = p.sourceOf(id);
    if (source === undefined) {
      orphans.push(id);
    } else {
      bySource.set(source, [...(bySource.get(source) ?? []), id]);
    }
  }
  return { bySource, orphans };
}

/** Outcomes nothing else placed go in one last row, left to right. */
function placeOrphans(p: PlaceParams, orphans: string[], y: number): void {
  let x = LAYOUT_MARGIN_X;
  for (const id of orphans) {
    p.positioned.set(id, { x, y, band: p.band(id) });
    x += p.widthOf(id) + OUTCOME_GAP;
  }
}

function bottomOf(p: PlaceParams): number {
  let bottom = LAYOUT_MARGIN_Y;
  for (const [id, point] of p.positioned) {
    bottom = Math.max(bottom, point.y + (p.heights.get(id) ?? OUTCOME_NODE_HEIGHT));
  }
  return bottom;
}

/**
 * Flow: one stage per row, top to bottom. Parallel steps sit side by side with the main chain in
 * the middle; outcomes hang off the outer side of their step (or below it when it is in the middle).
 */
function placeFlow(p: PlaceParams): void {
  const { bySource, orphans } = outcomesBySource(p);
  let y = LAYOUT_MARGIN_Y;
  for (const list of stageLists(p)) {
    // Main chain in the middle, the others alternating either side of it.
    const row: string[] = [];
    list.forEach((id, index) => (index % 2 === 0 ? row.unshift(id) : row.push(id)));
    const total = row.length * NODE_WIDTH + (row.length - 1) * FLOW_COLUMN_GAP;
    let rowHeight = 0;
    row.forEach((id, index) => {
      const x = -total / 2 + index * (NODE_WIDTH + FLOW_COLUMN_GAP);
      const height = p.heights.get(id) ?? 0;
      p.positioned.set(id, { x, y });
      const mine = bySource.get(id) ?? [];
      const stackHeight = mine.length * OUTCOME_NODE_HEIGHT + Math.max(0, mine.length - 1) * OUTCOME_GAP;
      const side = index === row.length - 1 ? "right" : index === 0 ? "left" : "below";
      let outcomeY = side === "below" ? y + height + OUTCOME_GAP : y + Math.max(0, (height - stackHeight) / 2);
      for (const outcome of mine) {
        const width = p.widthOf(outcome);
        // A side outcome's label sits in the gap, so the gap grows to fit it.
        const gap = Math.max(FLOW_OUTCOME_GAP, p.labelWidthOf(outcome) + 2 * FLOW_LABEL_CLEARANCE);
        const outcomeX = side === "right"
          ? x + NODE_WIDTH + gap
          : side === "left" ? x - gap - width : x + (NODE_WIDTH - width) / 2;
        p.positioned.set(outcome, { x: outcomeX, y: outcomeY, band: p.band(outcome) });
        outcomeY += OUTCOME_NODE_HEIGHT + OUTCOME_GAP;
      }
      rowHeight = Math.max(rowHeight, height, side === "below" ? height + OUTCOME_GAP + stackHeight : stackHeight);
    });
    y += rowHeight + FLOW_ROW_GAP;
  }
  placeOrphans(p, orphans, bottomOf(p) + FLOW_ROW_GAP);
  // Rows were centred on x = 0; move the whole map so it starts at the margin like the other views.
  const minX = Math.min(...[...p.positioned.values()].map((point) => point.x));
  for (const point of p.positioned.values()) {
    point.x += LAYOUT_MARGIN_X - minX;
  }
}

/**
 * Wrap: rows of a few stages, each read left to right. Parallel steps stack in their stage's
 * column. A row-top step's first outcome sits in a band above the row (except at the start of a
 * later row, where the line comes in); other outcomes stack under their step. Returns each row's
 * bottom so the row-turn edges can run beneath it.
 */
function placeWrap(p: PlaceParams): number[] {
  const { bySource, orphans } = outcomesBySource(p);
  const stages = stageLists(p);
  const perRow = Math.max(3, Math.ceil(Math.sqrt(stages.length)));
  const columnWidth = NODE_WIDTH + LAYOUT_RANK_SEP;
  const rowBottoms: number[] = [];
  let y = LAYOUT_MARGIN_Y;
  for (let first = 0, row = 0; first < stages.length; first += perRow, row += 1) {
    const chunk = stages.slice(first, first + perRow);
    const lifts = chunk.map((list, column) => !(row > 0 && column === 0) && (bySource.get(list[0]!)?.length ?? 0) > 0);
    const top = y + (lifts.some(Boolean) ? OUTCOME_NODE_HEIGHT + WRAP_BAND_GAP : 0);
    let bottom = top;
    chunk.forEach((list, column) => {
      const x = LAYOUT_MARGIN_X + column * columnWidth;
      let stackY = top;
      list.forEach((id, index) => {
        p.positioned.set(id, { x, y: stackY, row });
        stackY += p.heights.get(id) ?? 0;
        const mine = [...(bySource.get(id) ?? [])];
        if (index === 0 && lifts[column] === true) {
          const lifted = mine.shift()!;
          p.positioned.set(lifted, { x: x + (NODE_WIDTH - p.widthOf(lifted)) / 2, y, band: p.band(lifted), row });
        }
        for (const outcome of mine) {
          stackY += OUTCOME_GAP;
          p.positioned.set(outcome, { x: x + (NODE_WIDTH - p.widthOf(outcome)) / 2, y: stackY, band: p.band(outcome), row });
          stackY += OUTCOME_NODE_HEIGHT;
        }
        stackY += WORK_NODE_GAP;
      });
      bottom = Math.max(bottom, stackY - WORK_NODE_GAP);
    });
    rowBottoms.push(bottom);
    y = bottom + WRAP_ROW_GAP;
  }
  placeOrphans(p, orphans, y);
  return rowBottoms;
}
