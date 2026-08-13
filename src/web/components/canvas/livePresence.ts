/** Same-workflow live presence: project a graph, diff additions, and choose the next reveal. */
import type { Workflow, WorkflowConnection } from "@schema/workflow";
import type { CanvasFlowNode, WorkflowFlowEdge } from "./types";

export interface PresencePoint {
  x: number;
  y: number;
}

export interface PresenceGraphNode {
  id: string;
  order: number;
}

export interface PresenceGraphEdge {
  key: string;
  renderId: string;
  source: string;
  target: string;
  order: number;
}

export interface PresenceGraph {
  workflowId: string;
  nodes: PresenceGraphNode[];
  edges: PresenceGraphEdge[];
}

export type PresenceNodeOperation = {
  kind: "node";
  id: string;
  order: number;
};

export type PresenceEdgeOperation = {
  kind: "edge";
  key: string;
  renderId: string;
  source: string;
  target: string;
  order: number;
};

export type PresenceOperation = PresenceNodeOperation | PresenceEdgeOperation;

export type PresencePhase = "moving" | "revealing" | "drawing";
export type PresenceWrapperState = "pending" | "drawing";

export interface PresenceState {
  workflowId: string | null;
  graph: PresenceGraph | null;
  pendingNodeIds: string[];
  pendingEdgeKeys: string[];
  visibleNodeIds: string[];
  visibleEdgeKeys: string[];
  active: PresenceOperation | null;
  activePhase: PresencePhase | null;
  drawingDurationMs: number;
}

export interface PresenceView {
  pendingNodeIds: ReadonlySet<string>;
  revealingNodeId: string | null;
  edgePresence: ReadonlyMap<string, { phase: PresenceWrapperState; durationMs: number; key: string }>;
  cursor: { phase: PresencePhase; operation: string } | null;
}

export interface PresenceDriver {
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  animateCursor(points: readonly PresencePoint[], ms: number, signal: AbortSignal): Promise<void>;
}

export const PRESENCE_TIMINGS = {
  cursorMinMs: 180,
  cursorMaxMs: 600,
  edgeMinMs: 300,
  edgeMaxMs: 750,
  revealMs: 150,
  dwellMs: 150,
} as const;

export const PresenceTimings = PRESENCE_TIMINGS;

export function createInitialPresenceState(): PresenceState {
  return {
    workflowId: null,
    graph: null,
    pendingNodeIds: [],
    pendingEdgeKeys: [],
    visibleNodeIds: [],
    visibleEdgeKeys: [],
    active: null,
    activePhase: null,
    drawingDurationMs: 0,
  };
}

export function presenceEdgeKey(connection: WorkflowConnection, pairOccurrence: number): string {
  return connection.id !== undefined ? `id:${connection.id}` : `pair:${connection.from}->${connection.to}#${pairOccurrence}`;
}

export function presenceOperationId(operation: PresenceOperation): string {
  return operation.kind === "node" ? `node:${operation.id}` : `edge:${operation.key}`;
}

export function projectPresenceGraph(workflow: Workflow): PresenceGraph {
  const stepIds = new Set(workflow.steps.map((step) => step.id));
  const pairCount = new Map<string, number>();

  return {
    workflowId: workflow.id,
    nodes: workflow.steps.map((step, order) => ({ id: step.id, order })),
    edges: workflow.connections.flatMap((connection, index) => {
      if (!stepIds.has(connection.from) || !stepIds.has(connection.to)) {
        return [];
      }
      const pair = `${connection.from}->${connection.to}`;
      const occurrence = pairCount.get(pair) ?? 0;
      if (connection.id === undefined) {
        pairCount.set(pair, occurrence + 1);
      }
      return [{
        key: presenceEdgeKey(connection, occurrence),
        renderId: connection.id ?? `${connection.from}->${connection.to}#${index}`,
        source: connection.from,
        target: connection.to,
        order: index,
      }];
    }),
  };
}

export function flushPresence(graph: PresenceGraph | null): PresenceState {
  if (graph === null) {
    return createInitialPresenceState();
  }
  return {
    workflowId: graph.workflowId,
    graph,
    pendingNodeIds: [],
    pendingEdgeKeys: [],
    visibleNodeIds: graph.nodes.map((node) => node.id),
    visibleEdgeKeys: graph.edges.map((edge) => edge.key),
    active: null,
    activePhase: null,
    drawingDurationMs: 0,
  };
}

export function reconcilePresence(
  state: PresenceState,
  nextGraph: PresenceGraph | null,
  options: { flush?: boolean } = {},
): PresenceState {
  if (nextGraph === null) {
    return state.graph === null ? state : createInitialPresenceState();
  }
  if (options.flush === true) {
    return isFlushed(state, nextGraph) ? retainGraph(state, nextGraph) : flushPresence(nextGraph);
  }
  if (state.graph === nextGraph) {
    return state;
  }
  if (state.graph === null || state.workflowId !== nextGraph.workflowId) {
    return flushPresence(nextGraph);
  }

  const previousNodeIds = new Set(state.graph.nodes.map((node) => node.id));
  const previousEdgeKeys = new Set(state.graph.edges.map((edge) => edge.key));
  const nextNodeIds = new Set(nextGraph.nodes.map((node) => node.id));
  const nextEdgeKeys = new Set(nextGraph.edges.map((edge) => edge.key));

  const addedNodeIds = nextGraph.nodes.filter((node) => !previousNodeIds.has(node.id)).map((node) => node.id);
  const addedEdgeKeys = nextGraph.edges.filter((edge) => !previousEdgeKeys.has(edge.key)).map((edge) => edge.key);
  const pendingNodeIds = uniqueIds([
    ...state.pendingNodeIds.filter((id) => nextNodeIds.has(id)),
    ...addedNodeIds,
  ]);
  const pendingEdgeKeys = uniqueIds([
    ...state.pendingEdgeKeys.filter((key) => nextEdgeKeys.has(key)),
    ...addedEdgeKeys,
  ]);
  const active = isActiveStillValid(state.active, nextNodeIds, nextEdgeKeys) ? state.active : null;
  const next: PresenceState = {
    workflowId: nextGraph.workflowId,
    graph: nextGraph,
    pendingNodeIds,
    pendingEdgeKeys,
    visibleNodeIds: nextGraph.nodes.map((node) => node.id).filter((id) => !pendingNodeIds.includes(id)),
    visibleEdgeKeys: nextGraph.edges.map((edge) => edge.key).filter((key) => !pendingEdgeKeys.includes(key)),
    active,
    activePhase: active === null ? null : state.activePhase,
    drawingDurationMs: active === null ? 0 : state.drawingDurationMs,
  };
  return samePresenceWork(state, next) ? retainGraph(state, nextGraph) : next;
}

export function setPresencePhase(
  state: PresenceState,
  phase: PresencePhase,
  drawingDurationMs = state.drawingDurationMs,
): PresenceState {
  if (state.active === null) {
    return state;
  }
  return { ...state, activePhase: phase, drawingDurationMs };
}

export function startPresenceOperation(state: PresenceState, operation: PresenceOperation): PresenceState {
  return {
    ...state,
    active: operation,
    activePhase: "moving",
    drawingDurationMs: 0,
  };
}

export function finishPresenceOperation(state: PresenceState, operation: PresenceOperation): PresenceState {
  if (operation.kind === "node") {
    return {
      ...state,
      pendingNodeIds: state.pendingNodeIds.filter((id) => id !== operation.id),
      visibleNodeIds: uniqueIds([...state.visibleNodeIds, operation.id]),
      active: null,
      activePhase: null,
      drawingDurationMs: 0,
    };
  }
  return {
    ...state,
    pendingEdgeKeys: state.pendingEdgeKeys.filter((key) => key !== operation.key),
    visibleEdgeKeys: uniqueIds([...state.visibleEdgeKeys, operation.key]),
    active: null,
    activePhase: null,
    drawingDurationMs: 0,
  };
}

export function selectNextOperation(
  state: PresenceState,
  positions: ReadonlyMap<string, PresencePoint>,
  cursor: PresencePoint | null = null,
): PresenceOperation | null {
  if (state.graph === null || state.active !== null) {
    return null;
  }

  const visible = new Set(state.visibleNodeIds);
  const nodesById = new Map(state.graph.nodes.map((node) => [node.id, node]));
  const edgesByKey = new Map(state.graph.edges.map((edge) => [edge.key, edge]));
  const candidates: PresenceOperation[] = [];

  for (const id of state.pendingNodeIds) {
    const node = nodesById.get(id);
    if (node !== undefined && positions.has(node.id)) {
      candidates.push({ kind: "node", id: node.id, order: node.order });
    }
  }
  for (const key of state.pendingEdgeKeys) {
    const edge = edgesByKey.get(key);
    if (
      edge !== undefined
      && visible.has(edge.source)
      && visible.has(edge.target)
      && positions.has(edge.source)
      && positions.has(edge.target)
    ) {
      candidates.push({ kind: "edge", ...edge });
    }
  }
  if (candidates.length === 0) {
    return null;
  }

  let best = candidates[0]!;
  let bestDistance = operationTravel(best, positions, cursor, visible);
  for (let index = 1; index < candidates.length; index += 1) {
    const candidate = candidates[index]!;
    const distance = operationTravel(candidate, positions, cursor, visible);
    if (compareOperations(candidate, distance, best, bestDistance) < 0) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

export function resolveCursorStart(
  cursor: PresencePoint | null,
  target: PresencePoint,
  visiblePositions: readonly PresencePoint[],
): PresencePoint {
  if (cursor !== null) {
    return cursor;
  }
  if (visiblePositions.length === 0) {
    return target;
  }
  let nearest = visiblePositions[0]!;
  let nearestDistance = distanceBetween(nearest, target);
  for (let index = 1; index < visiblePositions.length; index += 1) {
    const point = visiblePositions[index]!;
    const distance = distanceBetween(point, target);
    if (distance < nearestDistance) {
      nearest = point;
      nearestDistance = distance;
    }
  }
  return nearest;
}

export function operationTarget(
  operation: PresenceOperation,
  positions: ReadonlyMap<string, PresencePoint>,
): PresencePoint | null {
  if (operation.kind === "node") {
    return positions.get(operation.id) ?? null;
  }
  return positions.get(operation.source) ?? null;
}

export function nodeCenter(node: Pick<CanvasFlowNode, "position" | "width" | "height" | "measured">): PresencePoint {
  const width = node.measured?.width ?? node.width ?? 0;
  const height = node.measured?.height ?? node.height ?? 0;
  return { x: node.position.x + width / 2, y: node.position.y + height / 2 };
}

export function collectNodeCenters(nodes: readonly CanvasFlowNode[]): Map<string, PresencePoint> {
  return new Map(nodes.map((node) => [node.id, nodeCenter(node)]));
}

export function visibleNodeCenters(
  nodes: readonly CanvasFlowNode[],
  visibleNodeIds: readonly string[],
): PresencePoint[] {
  const visible = new Set(visibleNodeIds);
  return nodes.filter((node) => visible.has(node.id)).map((node) => nodeCenter(node));
}

export function distanceBetween(a: PresencePoint, b: PresencePoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function cursorDurationMs(distance: number): number {
  return clampDuration(distance * 0.7, PRESENCE_TIMINGS.cursorMinMs, PRESENCE_TIMINGS.cursorMaxMs);
}

export function edgeDurationMs(length: number): number {
  return clampDuration(length * 0.85, PRESENCE_TIMINGS.edgeMinMs, PRESENCE_TIMINGS.edgeMaxMs);
}

export function buildCurvedPath(from: PresencePoint, to: PresencePoint, samples = 16): PresencePoint[] {
  if (from.x === to.x && from.y === to.y) {
    return [to];
  }
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const offset = Math.min(48, length * 0.12);
  const control = {
    x: (from.x + to.x) / 2 + (-dy / length) * offset,
    y: (from.y + to.y) / 2 + (dx / length) * offset,
  };
  const points: PresencePoint[] = [];
  for (let index = 0; index <= samples; index += 1) {
    const t = index / samples;
    const inverse = 1 - t;
    points.push({
      x: inverse * inverse * from.x + 2 * inverse * t * control.x + t * t * to.x,
      y: inverse * inverse * from.y + 2 * inverse * t * control.y + t * t * to.y,
    });
  }
  return points;
}

export function buildPresenceView(state: PresenceState): PresenceView {
  const pendingNodeIds = new Set(state.pendingNodeIds);
  const revealingNodeId = state.active?.kind === "node" && state.activePhase === "revealing" ? state.active.id : null;
  const edgePresence = new Map<string, { phase: PresenceWrapperState; durationMs: number; key: string }>();
  const pendingEdgeKeys = new Set(state.pendingEdgeKeys);

  for (const edge of state.graph?.edges ?? []) {
    if (!pendingEdgeKeys.has(edge.key)) {
      continue;
    }
    const drawing = state.active?.kind === "edge" && state.active.key === edge.key && state.activePhase === "drawing";
    edgePresence.set(edge.renderId, {
      phase: drawing ? "drawing" : "pending",
      durationMs: drawing ? state.drawingDurationMs : 0,
      key: edge.key,
    });
  }

  return {
    pendingNodeIds,
    revealingNodeId,
    edgePresence,
    cursor: state.active !== null && state.activePhase !== null
      ? { phase: state.activePhase, operation: presenceOperationId(state.active) }
      : null,
  };
}

export function applyPresenceToNodes(nodes: CanvasFlowNode[], view: PresenceView): CanvasFlowNode[] {
  if (view.pendingNodeIds.size === 0) {
    return nodes;
  }
  return nodes.map((node): CanvasFlowNode => {
    if (!view.pendingNodeIds.has(node.id) || view.revealingNodeId === node.id) {
      return node;
    }
    const pendingStyle = {
      ...node.style,
      opacity: 0,
      visibility: "hidden" as const,
      pointerEvents: "none" as const,
    };
    const pendingAttributes = {
      ...node.domAttributes,
      "data-presence-state": "pending",
      "aria-hidden": true,
    };
    if (node.type === "outcome") {
      return {
        ...node,
        style: pendingStyle,
        domAttributes: pendingAttributes,
        data: { ...node.data, tabIndex: -1 },
      };
    }
    return {
      ...node,
      style: pendingStyle,
      domAttributes: pendingAttributes,
      data: { ...node.data, tabIndex: -1 },
    };
  });
}

export function applyPresenceToEdges(edges: WorkflowFlowEdge[], view: PresenceView): WorkflowFlowEdge[] {
  if (view.edgePresence.size === 0) {
    return edges;
  }
  return edges.map((edge) => {
    const presence = view.edgePresence.get(edge.id);
    if (presence === undefined || edge.data === undefined) {
      return edge;
    }
    return {
      ...edge,
      domAttributes: {
        ...edge.domAttributes,
        "data-presence-state": presence.phase,
      },
      data: {
        ...edge.data,
        presence: {
          phase: presence.phase,
          durationMs: presence.durationMs,
          key: presence.key,
        },
      },
    };
  });
}

function retainGraph(state: PresenceState, graph: PresenceGraph): PresenceState {
  return state.graph === graph ? state : { ...state, graph, workflowId: graph.workflowId };
}

function isFlushed(state: PresenceState, graph: PresenceGraph): boolean {
  return state.workflowId === graph.workflowId
    && state.active === null
    && state.pendingNodeIds.length === 0
    && state.pendingEdgeKeys.length === 0
    && state.visibleNodeIds.length === graph.nodes.length
    && state.visibleEdgeKeys.length === graph.edges.length;
}

function samePresenceWork(left: PresenceState, right: PresenceState): boolean {
  return left.active === right.active
    && left.activePhase === right.activePhase
    && left.drawingDurationMs === right.drawingDurationMs
    && sameStringList(left.pendingNodeIds, right.pendingNodeIds)
    && sameStringList(left.pendingEdgeKeys, right.pendingEdgeKeys)
    && sameStringList(left.visibleNodeIds, right.visibleNodeIds)
    && sameStringList(left.visibleEdgeKeys, right.visibleEdgeKeys);
}

function sameStringList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function uniqueIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    result.push(id);
  }
  return result;
}

function isActiveStillValid(
  active: PresenceOperation | null,
  nextNodeIds: ReadonlySet<string>,
  nextEdgeKeys: ReadonlySet<string>,
): active is PresenceOperation {
  if (active === null) {
    return false;
  }
  return active.kind === "node" ? nextNodeIds.has(active.id) : nextEdgeKeys.has(active.key);
}

function operationTravel(
  operation: PresenceOperation,
  positions: ReadonlyMap<string, PresencePoint>,
  cursor: PresencePoint | null,
  visibleNodeIds: ReadonlySet<string>,
): number {
  const target = operationTarget(operation, positions);
  if (target === null) {
    return Number.POSITIVE_INFINITY;
  }
  const visiblePositions = [...visibleNodeIds]
    .map((id) => positions.get(id))
    .filter((point): point is PresencePoint => point !== undefined);
  return distanceBetween(resolveCursorStart(cursor, target, visiblePositions), target);
}

function compareOperations(
  left: PresenceOperation,
  leftDistance: number,
  right: PresenceOperation,
  rightDistance: number,
): number {
  if (leftDistance !== rightDistance) {
    return leftDistance - rightDistance;
  }
  if (left.order !== right.order) {
    return left.order - right.order;
  }
  const leftKey = left.kind === "node" ? left.id : left.key;
  const rightKey = right.kind === "node" ? right.id : right.key;
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function clampDuration(value: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, value)));
}

export function hasPresenceWork(state: PresenceState): boolean {
  return state.active !== null || state.pendingNodeIds.length > 0 || state.pendingEdgeKeys.length > 0;
}

export function sampleSvgPath(path: Pick<SVGPathElement, "getTotalLength" | "getPointAtLength">, samples = 24): { points: PresencePoint[]; length: number } | null {
  const length = path.getTotalLength();
  if (!Number.isFinite(length) || length <= 0) {
    return null;
  }
  const points: PresencePoint[] = [];
  for (let index = 0; index <= samples; index += 1) {
    const point = path.getPointAtLength((length * index) / samples);
    points.push({ x: point.x, y: point.y });
  }
  return { points, length };
}

export async function runPresenceSession(options: {
  getState: () => PresenceState;
  setState: (state: PresenceState) => void;
  getPositions: () => ReadonlyMap<string, PresencePoint>;
  getCursor: () => PresencePoint | null;
  sampleEdge: (renderId: string) => { points: PresencePoint[]; length: number } | null;
  driver: PresenceDriver;
  signal: AbortSignal;
}): Promise<void> {
  const { getState, setState, getPositions, getCursor, sampleEdge, driver, signal } = options;

  while (!signal.aborted) {
    let state = getState();
    if (state.active === null) {
      const operation = selectNextOperation(state, getPositions(), getCursor());
      if (operation === null) {
        return;
      }
      state = startPresenceOperation(state, operation);
      setState(state);
    }

    const operation = state.active;
    if (operation === null) {
      return;
    }

    try {
      if (operation.kind === "node") {
        await runNodeOperation({ operation, getState, setState, getPositions, getCursor, driver, signal });
      } else {
        await runEdgeOperation({ operation, getState, setState, getPositions, getCursor, sampleEdge, driver, signal });
      }
    } catch (error) {
      if (isAbortError(error) || signal.aborted) {
        return;
      }
      throw error;
    }
  }
}

async function runNodeOperation(options: {
  operation: PresenceNodeOperation;
  getState: () => PresenceState;
  setState: (state: PresenceState) => void;
  getPositions: () => ReadonlyMap<string, PresencePoint>;
  getCursor: () => PresencePoint | null;
  driver: PresenceDriver;
  signal: AbortSignal;
}): Promise<void> {
  const { operation, getState, setState, getPositions, getCursor, driver, signal } = options;
  const target = getPositions().get(operation.id);
  if (target === undefined) {
    return;
  }

  const start = resolveCursorStart(getCursor(), target, visiblePositions(getState(), getPositions()));
  await driver.animateCursor(buildCurvedPath(start, target), cursorDurationMs(distanceBetween(start, target)), signal);
  if (!isCurrentOperation(getState(), operation)) {
    return;
  }
  setState(setPresencePhase(getState(), "revealing"));
  await driver.sleep(PRESENCE_TIMINGS.revealMs, signal);
  await driver.sleep(PRESENCE_TIMINGS.dwellMs, signal);
  finishIfCurrent(getState, setState, operation);
}

async function runEdgeOperation(options: {
  operation: PresenceEdgeOperation;
  getState: () => PresenceState;
  setState: (state: PresenceState) => void;
  getPositions: () => ReadonlyMap<string, PresencePoint>;
  getCursor: () => PresencePoint | null;
  sampleEdge: (renderId: string) => { points: PresencePoint[]; length: number } | null;
  driver: PresenceDriver;
  signal: AbortSignal;
}): Promise<void> {
  const { operation, getState, setState, getPositions, getCursor, sampleEdge, driver, signal } = options;
  const positions = getPositions();
  const source = positions.get(operation.source);
  const target = positions.get(operation.target);
  if (source === undefined || target === undefined) {
    return;
  }

  const start = resolveCursorStart(getCursor(), source, visiblePositions(getState(), positions));
  await driver.animateCursor(buildCurvedPath(start, source), cursorDurationMs(distanceBetween(start, source)), signal);
  if (!isCurrentOperation(getState(), operation)) {
    return;
  }

  const sampled = sampleEdge(operation.renderId);
  const points = sampled?.points ?? buildCurvedPath(source, target);
  const duration = edgeDurationMs(sampled?.length ?? distanceBetween(source, target));
  setState(setPresencePhase(getState(), "drawing", duration));
  await driver.animateCursor(points, duration, signal);
  finishIfCurrent(getState, setState, operation);
}

function visiblePositions(state: PresenceState, positions: ReadonlyMap<string, PresencePoint>): PresencePoint[] {
  return state.visibleNodeIds
    .map((id) => positions.get(id))
    .filter((point): point is PresencePoint => point !== undefined);
}

function finishIfCurrent(
  getState: () => PresenceState,
  setState: (state: PresenceState) => void,
  operation: PresenceOperation,
): void {
  const state = getState();
  if (isCurrentOperation(state, operation)) {
    setState(finishPresenceOperation(state, operation));
  }
}

function isCurrentOperation(state: PresenceState, operation: PresenceOperation): boolean {
  return state.active !== null && presenceOperationId(state.active) === presenceOperationId(operation);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
