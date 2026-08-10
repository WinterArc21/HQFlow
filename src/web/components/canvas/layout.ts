/** Deterministic horizontal workflow layout. Work reads left-to-right; terminal output steps
 * occupy semantic bands above (failure) or below (success) the vertically-centred mainline. */
import type { Workflow, WorkflowConnection } from "@schema/workflow";
import type { Depth } from "../../store/useCodeHQStore";
import { outcomeTone } from "../../design/semantics";
import { computeBackEdgeIds, computeOutcomeStepIds, computeTopologicalOrder } from "./graph";
import { computeNodeHeight, computeOutcomeNodeWidth, effectiveDepthForStep, NODE_WIDTH, OUTCOME_NODE_HEIGHT } from "./nodeContent";

export const LAYOUT_RANK_SEP = 132;
export const LAYOUT_MARGIN_X = 48;
export const LAYOUT_MARGIN_Y = 48;
const OUTCOME_GAP = 30;
const FAILURE_TO_WORK_GAP = 128;
const WORK_LANE_GAP = 88;
const WORK_NODE_GAP = 52;
const WORK_TO_SUCCESS_GAP = 112;
const RETURN_EDGE_TOP_RESERVE = 112;

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
  depth: Depth;
  expandedStepIds: ReadonlySet<string> | Record<string, true>;
}
export interface LayoutResult {
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
      return [id, computeNodeHeight(step, effectiveDepthForStep(step, opts.depth, opts.expandedStepIds))] as const;
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
  const failureIds = outcomeIds.filter((id) => bandForOutcome(id) === "failure");
  const successIds = outcomeIds.filter((id) => bandForOutcome(id) === "success");
  const hasReturnEdge = valid.some(({ connection, id }) => backEdgeIds.has(id) && connection.from !== connection.to);
  const failureY = LAYOUT_MARGIN_Y;
  const mainTopY = failureIds.length > 0
    ? failureY + OUTCOME_NODE_HEIGHT + FAILURE_TO_WORK_GAP
    : LAYOUT_MARGIN_Y + (hasReturnEdge ? RETURN_EDGE_TOP_RESERVE : 0);
  const maxMainlineHeight = Math.max(0, ...workIds.filter((id) => mainline.has(id)).map((id) => heights.get(id) ?? 0));
  const mainCenterY = mainTopY + maxMainlineHeight / 2;
  const positioned = new Map<string, { x: number; y: number; band?: OutcomeBand }>();

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

  const nodes = workflow.steps.map((step, index): LayoutNode => {
    const isOutcome = outcomes.has(step.id);
    const height = isOutcome
      ? OUTCOME_NODE_HEIGHT
      : (heights.get(step.id) ?? computeNodeHeight(step, effectiveDepthForStep(step, opts.depth, opts.expandedStepIds)));
    const point = positioned.get(step.id) ?? {
      x: LAYOUT_MARGIN_X + index * (NODE_WIDTH + LAYOUT_RANK_SEP),
      y: mainCenterY - height / 2,
    };
    return {
      id: step.id,
      x: point.x,
      y: point.y,
      width: isOutcome ? computeOutcomeNodeWidth(step) : NODE_WIDTH,
      height,
      index,
      isOutcome,
      ...(point.band !== undefined ? { outcomeBand: point.band } : {}),
    };
  });
  const edges = valid.map(({ connection, index }) => ({
    id: edgeId(connection, index),
    source: connection.from,
    target: connection.to,
    connection,
  }));
  if (nodes.length === 0) {
    return { nodes, edges, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 } };
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
  return { nodes, edges, bounds: { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY } };
}
