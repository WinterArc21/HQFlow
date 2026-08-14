/**
 * Small, deterministic geometry owner for live edge routing.
 *
 * This is deliberately not a general path finder. It evaluates a bounded set of Manhattan
 * routes through the useful corridors beside card rectangles. The canvas can therefore run it
 * synchronously for every drag update without a queue, a timer, or a graph-search state machine.
 */

/** A visible card rectangle in the same coordinate space as React Flow edge endpoints. */
export interface RouteObstacle {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RoutePoint {
  x: number;
  y: number;
}

export type RouteSide = "left" | "right" | "top" | "bottom";

/**
 * The card border and shadow need a little visual air. There was no shared canvas clearance
 * token, so keep this modest fixed value beside the geometry that owns it: 20px leaves 8px more
 * than the e2e occlusion probe's 12px visible margin without moving endpoints or adding handles.
 */
export const EDGE_OBSTACLE_CLEARANCE = 20;

/** The short straight lead keeps a route outside the source/target card before it turns. */
const ENDPOINT_STUB = EDGE_OBSTACLE_CLEARANCE + 4;
const CORNER_RADIUS = 12;
// Keep every rounded corner outside the inflated rectangle: the curve can consume at most its
// radius toward a corner, so this gap leaves a small deterministic margin after smoothing.
const CORRIDOR_GAP = CORNER_RADIUS + 2;
const MAX_ROUTING_OBSTACLES = 64;
// Keep the per-edge family small: the direct, one-axis, and x/y combinations produce at most
// 26 candidates while retaining the nearest corridors and both outer escape lanes.
const MAX_CORRIDORS_PER_AXIS = 3;
const MAX_ROUTE_CANDIDATES = 36;

export interface RouteCandidate {
  points: RoutePoint[];
  collisionCount: number;
  length: number;
  turnCount: number;
  /** Lower values preserve the already selected source/target cardinal ports. */
  portPreference: number;
  /** Stable final tie-breaker based on deterministic candidate generation order. */
  order: number;
}

/**
 * Immutable obstacle work shared by every edge in one canvas update. Node bounds move together
 * with the React Flow update, so the canvas prepares inflation and obstacle corridors once and
 * each edge reuses this object instead of rebuilding the same arrays.
 */
export interface ObstacleRoutingContext {
  obstacles: readonly RouteObstacle[];
  inflated: readonly RouteObstacle[];
  obstacleCorridorXs: readonly number[];
  obstacleCorridorYs: readonly number[];
  clearance: number;
  canRoute: boolean;
}

export interface ObstacleRouteOptions {
  source: RoutePoint;
  target: RoutePoint;
  sourcePosition: RouteSide;
  targetPosition: RouteSide;
  obstacles: readonly RouteObstacle[];
  /** Endpoint ids let the first/last attachment segment touch its own card without exempting a
   * later detour that runs behind that card. They are optional for pure geometry callers that pass
   * only unrelated obstacles. */
  sourceId?: string;
  targetId?: string;
  clearance?: number;
  /** Prepared once by the canvas; omitted by pure callers, which prepare it locally. */
  context?: ObstacleRoutingContext;
}

function normaliseRect(rect: RouteObstacle): RouteObstacle {
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  const x = Math.min(rect.x, right);
  const y = Math.min(rect.y, bottom);
  return { ...rect, x, y, width: Math.abs(rect.width), height: Math.abs(rect.height) };
}

export function inflateObstacle(rect: RouteObstacle, clearance = EDGE_OBSTACLE_CLEARANCE): RouteObstacle {
  const normalised = normaliseRect(rect);
  return {
    ...normalised,
    x: normalised.x - clearance,
    y: normalised.y - clearance,
    width: normalised.width + clearance * 2,
    height: normalised.height + clearance * 2,
  };
}

/** Prepares the bounded, immutable geometry shared by all ordinary edges in one canvas update. */
export function prepareObstacleRoutingContext(
  obstacles: readonly RouteObstacle[],
  clearance = EDGE_OBSTACLE_CLEARANCE,
): ObstacleRoutingContext {
  if (obstacles.length > MAX_ROUTING_OBSTACLES) {
    return {
      obstacles,
      inflated: [],
      obstacleCorridorXs: [],
      obstacleCorridorYs: [],
      clearance,
      canRoute: false,
    };
  }

  const inflated = obstacles.map((obstacle) => inflateObstacle(obstacle, clearance));
  const obstacleCorridorXs: number[] = [];
  const obstacleCorridorYs: number[] = [];
  let outerLeft = Number.POSITIVE_INFINITY;
  let outerRight = Number.NEGATIVE_INFINITY;
  let outerTop = Number.POSITIVE_INFINITY;
  let outerBottom = Number.NEGATIVE_INFINITY;
  for (const obstacle of inflated) {
    const right = obstacle.x + obstacle.width;
    const bottom = obstacle.y + obstacle.height;
    obstacleCorridorXs.push(obstacle.x - CORRIDOR_GAP, right + CORRIDOR_GAP);
    obstacleCorridorYs.push(obstacle.y - CORRIDOR_GAP, bottom + CORRIDOR_GAP);
    outerLeft = Math.min(outerLeft, obstacle.x);
    outerRight = Math.max(outerRight, right);
    outerTop = Math.min(outerTop, obstacle.y);
    outerBottom = Math.max(outerBottom, bottom);
  }
  if (inflated.length > 0) {
    obstacleCorridorXs.push(outerLeft - CORRIDOR_GAP, outerRight + CORRIDOR_GAP);
    obstacleCorridorYs.push(outerTop - CORRIDOR_GAP, outerBottom + CORRIDOR_GAP);
  }

  return {
    obstacles,
    inflated,
    obstacleCorridorXs,
    obstacleCorridorYs,
    clearance,
    canRoute: true,
  };
}

/** Closed segment-vs-rectangle test. Touching the inflated border counts as a collision. */
function segmentIntersectsNormalisedRect(start: RoutePoint, end: RoutePoint, obstacle: RouteObstacle): boolean {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    return start.x >= obstacle.x && start.x <= obstacle.x + obstacle.width
      && start.y >= obstacle.y && start.y <= obstacle.y + obstacle.height;
  }

  let entering = 0;
  let leaving = 1;
  const clips: Array<[number, number]> = [
    [-dx, start.x - obstacle.x],
    [dx, obstacle.x + obstacle.width - start.x],
    [-dy, start.y - obstacle.y],
    [dy, obstacle.y + obstacle.height - start.y],
  ];
  for (const [coefficient, distance] of clips) {
    if (coefficient === 0) {
      if (distance < 0) {
        return false;
      }
      continue;
    }
    const ratio = distance / coefficient;
    if (coefficient < 0) {
      entering = Math.max(entering, ratio);
    } else {
      leaving = Math.min(leaving, ratio);
    }
    if (entering > leaving) {
      return false;
    }
  }
  return leaving >= 0 && entering <= 1 && entering <= leaving;
}

/** Closed segment-vs-rectangle test. Touching the rectangle border counts as a collision. */
export function segmentIntersectsRect(start: RoutePoint, end: RoutePoint, rect: RouteObstacle): boolean {
  return segmentIntersectsNormalisedRect(start, end, normaliseRect(rect));
}

interface PathBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * React Flow's Bezier and smooth-step paths use only coordinate pairs in M/L/Q/C commands.
 * Their control-point bounds are a conservative envelope for the rendered curve, so an obstacle
 * outside this box cannot affect the default path. An unrecognised path is routed conservatively.
 */
function pathCoordinateBounds(path: string): PathBounds | null {
  const values = path.match(/-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/gi)?.map(Number) ?? [];
  if (values.length < 2 || values.length % 2 !== 0 || values.some((value) => !Number.isFinite(value))) {
    return null;
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < values.length; index += 2) {
    const x = values[index]!;
    const y = values[index + 1]!;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

function boundsOverlap(left: PathBounds, right: RouteObstacle): boolean {
  return left.minX <= right.x + right.width
    && left.maxX >= right.x
    && left.minY <= right.y + right.height
    && left.maxY >= right.y;
}

/** Fast conservative gate: clear default paths skip candidate generation entirely. */
export function pathMayNeedObstacleRoute(
  path: string,
  context: ObstacleRoutingContext,
  sourceId?: string,
  targetId?: string,
): boolean {
  if (!context.canRoute) {
    return false;
  }
  const bounds = pathCoordinateBounds(path);
  if (bounds === null) {
    return true;
  }
  return context.inflated.some((obstacle) =>
    obstacle.id !== sourceId && obstacle.id !== targetId && boundsOverlap(bounds, obstacle));
}

function pointInsideRect(point: RoutePoint, rect: RouteObstacle): boolean {
  const obstacle = normaliseRect(rect);
  return point.x >= obstacle.x && point.x <= obstacle.x + obstacle.width
    && point.y >= obstacle.y && point.y <= obstacle.y + obstacle.height;
}

function samePoint(left: RoutePoint, right: RoutePoint): boolean {
  return left.x === right.x && left.y === right.y;
}

/** Removes zero-length and unnecessary collinear legs while retaining the exact endpoints. */
function simplifyOrthogonalPoints(points: readonly RoutePoint[]): RoutePoint[] {
  const withoutDuplicates: RoutePoint[] = [];
  for (const point of points) {
    const previous = withoutDuplicates.at(-1);
    if (previous === undefined || !samePoint(previous, point)) {
      withoutDuplicates.push({ x: point.x, y: point.y });
    }
  }

  const simplified: RoutePoint[] = [];
  for (const point of withoutDuplicates) {
    const previous = simplified.at(-1);
    const beforePrevious = simplified.at(-2);
    if (
      previous !== undefined &&
      beforePrevious !== undefined &&
      ((beforePrevious.x === previous.x && previous.x === point.x)
        || (beforePrevious.y === previous.y && previous.y === point.y))
    ) {
      simplified[simplified.length - 1] = point;
    } else {
      simplified.push(point);
    }
  }
  return simplified;
}

function pathLength(points: readonly RoutePoint[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const point = points[index]!;
    length += Math.hypot(point.x - previous.x, point.y - previous.y);
  }
  return length;
}

function direction(start: RoutePoint, end: RoutePoint): RouteSide | null {
  if (start.x === end.x) {
    return end.y >= start.y ? "bottom" : "top";
  }
  if (start.y === end.y) {
    return end.x >= start.x ? "right" : "left";
  }
  return null;
}

function opposite(side: RouteSide): RouteSide {
  switch (side) {
    case "left":
      return "right";
    case "right":
      return "left";
    case "top":
      return "bottom";
    case "bottom":
      return "top";
  }
}

function turnCount(points: readonly RoutePoint[]): number {
  let turns = 0;
  let previousDirection: RouteSide | null = null;
  for (let index = 1; index < points.length; index += 1) {
    const currentDirection = direction(points[index - 1]!, points[index]!);
    if (currentDirection === null) {
      continue;
    }
    if (previousDirection !== null && currentDirection !== previousDirection) {
      turns += 1;
    }
    previousDirection = currentDirection;
  }
  return turns;
}

function sideVector(side: RouteSide): RoutePoint {
  switch (side) {
    case "left":
      return { x: -1, y: 0 };
    case "right":
      return { x: 1, y: 0 };
    case "top":
      return { x: 0, y: -1 };
    case "bottom":
      return { x: 0, y: 1 };
  }
}

function offsetFromSide(point: RoutePoint, side: RouteSide, distance: number): RoutePoint {
  const vector = sideVector(side);
  return { x: point.x + vector.x * distance, y: point.y + vector.y * distance };
}

/**
 * Prefer routes that leave and arrive through the already selected cardinal ports. Generated
 * candidates all use those ports, so this is normally zero; it remains the final semantic
 * tie-break before deterministic generation order for alternate-port callers.
 */
function portPreference(points: readonly RoutePoint[], sourceSide: RouteSide, targetSide: RouteSide): number {
  if (points.length < 2) {
    return 2;
  }
  const firstDirection = direction(points[0]!, points[1]!);
  const lastDirection = direction(points[points.length - 2]!, points[points.length - 1]!);
  return (firstDirection === sourceSide ? 0 : 1) + (lastDirection === opposite(targetSide) ? 0 : 1);
}

function collisionCountForInflatedPoints(
  points: readonly RoutePoint[],
  obstacles: readonly RouteObstacle[],
  sourceId?: string,
  targetId?: string,
): number {
  if (points.length < 2) {
    return obstacles.some((obstacle) => pointInsideRect(points[0]!, obstacle)) ? 1 : 0;
  }

  let collisions = 0;
  const lastSegmentIndex = points.length - 2;
  const segments = points.slice(0, -1).map((start, segmentIndex) => {
    const end = points[segmentIndex + 1]!;
    return {
      start,
      end,
      minX: Math.min(start.x, end.x),
      maxX: Math.max(start.x, end.x),
      minY: Math.min(start.y, end.y),
      maxY: Math.max(start.y, end.y),
    };
  });
  for (const obstacle of obstacles) {
    let intersects = false;
    for (let segmentIndex = 0; segmentIndex <= lastSegmentIndex; segmentIndex += 1) {
      const isSourceAttachment = obstacle.id === sourceId && segmentIndex === 0;
      const isTargetAttachment = obstacle.id === targetId && segmentIndex === lastSegmentIndex;
      if (isSourceAttachment || isTargetAttachment) {
        continue;
      }
      const segment = segments[segmentIndex]!;
      if (
        segment.maxX < obstacle.x
        || segment.minX > obstacle.x + obstacle.width
        || segment.maxY < obstacle.y
        || segment.minY > obstacle.y + obstacle.height
      ) {
        continue;
      }
      if (segmentIntersectsNormalisedRect(segment.start, segment.end, obstacle)) {
        intersects = true;
        break;
      }
    }
    if (intersects) {
      collisions += 1;
    }
  }
  return collisions;
}

/** Counts obstacle rectangles touched by any route segment. Exported for focused unit proofs. */
export function routeCollisionCount(
  points: readonly RoutePoint[],
  obstacles: readonly RouteObstacle[],
  clearance = EDGE_OBSTACLE_CLEARANCE,
): number {
  const inflated = obstacles.map((obstacle) => inflateObstacle(obstacle, clearance));
  return collisionCountForInflatedPoints(points, inflated);
}

function uniqueSorted(values: readonly number[]): number[] {
  const sorted = [...values]
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  const unique: number[] = [];
  for (const value of sorted) {
    if (unique.at(-1) !== value) {
      unique.push(value);
    }
  }
  return unique;
}

function distanceToInterval(value: number, minimum: number, maximum: number): number {
  if (value < minimum) {
    return minimum - value;
  }
  if (value > maximum) {
    return value - maximum;
  }
  return 0;
}

/** Keeps the candidate set small while retaining nearest corridors and both outer escape lanes. */
function selectCorridors(values: readonly number[], minimum: number, maximum: number): number[] {
  const unique = uniqueSorted(values);
  const preferred = [...unique].sort(
    (left, right) =>
      distanceToInterval(left, minimum, maximum) - distanceToInterval(right, minimum, maximum)
      || Math.abs(left - (minimum + maximum) / 2) - Math.abs(right - (minimum + maximum) / 2)
      || left - right,
  );
  const selected: number[] = [];
  const add = (value: number | undefined) => {
    if (value !== undefined && !selected.includes(value) && selected.length < MAX_CORRIDORS_PER_AXIS) {
      selected.push(value);
    }
  };
  add(unique[0]);
  add(unique.at(-1));
  for (const value of preferred) {
    add(value);
  }
  return selected.sort((left, right) => left - right);
}

function routeKey(points: readonly RoutePoint[]): string {
  return points.map((point) => `${point.x}:${point.y}`).join("|");
}

/**
 * Builds the bounded orthogonal candidate family. One-axis corridors cover the usual detour
 * around one card; x/y pairs cover a compact cluster without creating an unbounded search graph.
 */
export function createRouteCandidates(options: ObstacleRouteOptions): RouteCandidate[] {
  const context = options.context ?? prepareObstacleRoutingContext(options.obstacles, options.clearance);
  if (!context.canRoute) {
    return [];
  }

  const inflated = context.inflated;
  const sourceExit = offsetFromSide(options.source, options.sourcePosition, ENDPOINT_STUB);
  const targetEntry = offsetFromSide(options.target, options.targetPosition, ENDPOINT_STUB);
  const minimumX = Math.min(sourceExit.x, targetEntry.x);
  const maximumX = Math.max(sourceExit.x, targetEntry.x);
  const minimumY = Math.min(sourceExit.y, targetEntry.y);
  const maximumY = Math.max(sourceExit.y, targetEntry.y);

  const corridorXs = [sourceExit.x, targetEntry.x, options.source.x, options.target.x, ...context.obstacleCorridorXs];
  const corridorYs = [sourceExit.y, targetEntry.y, options.source.y, options.target.y, ...context.obstacleCorridorYs];

  const xs = selectCorridors(corridorXs, minimumX, maximumX);
  const ys = selectCorridors(corridorYs, minimumY, maximumY);
  const candidates: RouteCandidate[] = [];
  const seen = new Set<string>();

  const addCandidate = (rawPoints: RoutePoint[]) => {
    if (candidates.length >= MAX_ROUTE_CANDIDATES) {
      return;
    }
    const points = simplifyOrthogonalPoints(rawPoints);
    if (points.length < 2 || points.some((point, index) => index > 0 && direction(points[index - 1]!, point) === null)) {
      return;
    }
    const key = routeKey(points);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    const preference = portPreference(points, options.sourcePosition, options.targetPosition);
    candidates.push({
      points,
      collisionCount: collisionCountForInflatedPoints(points, inflated, options.sourceId, options.targetId),
      length: pathLength(points),
      turnCount: turnCount(points),
      portPreference: preference,
      order: candidates.length,
    });
  };

  const start = [options.source, sourceExit];
  const finish = [targetEntry, options.target];
  // Direct two-turn candidates preserve the ordinary horizontal/vertical preference whenever no
  // obstacle forces a detour.
  addCandidate([...start, { x: sourceExit.x, y: targetEntry.y }, ...finish]);
  addCandidate([...start, { x: targetEntry.x, y: sourceExit.y }, ...finish]);

  for (const x of xs) {
    addCandidate([...start, { x, y: sourceExit.y }, { x, y: targetEntry.y }, ...finish]);
  }
  for (const y of ys) {
    addCandidate([...start, { x: sourceExit.x, y }, { x: targetEntry.x, y }, ...finish]);
  }
  for (const x of xs) {
    for (const y of ys) {
      addCandidate([
        ...start,
        { x, y: sourceExit.y },
        { x, y },
        { x: targetEntry.x, y },
        ...finish,
      ]);
      addCandidate([
        ...start,
        { x: sourceExit.x, y },
        { x, y },
        { x, y: targetEntry.y },
        ...finish,
      ]);
      if (candidates.length >= MAX_ROUTE_CANDIDATES) {
        return candidates;
      }
    }
  }
  return candidates;
}

/** Lexicographic route ordering: collisions, length, turns, side preference, stable order. */
export function compareRouteCandidates(left: RouteCandidate, right: RouteCandidate): number {
  return left.collisionCount - right.collisionCount
    || left.length - right.length
    || left.turnCount - right.turnCount
    || left.portPreference - right.portPreference
    || left.order - right.order;
}

/** Returns the best collision-free bounded candidate, or null so the caller can use its exact
 * pre-change React Flow geometry when every simple route is blocked. */
export function chooseObstacleAwareRoute(options: ObstacleRouteOptions): RouteCandidate | null {
  const candidates = createRouteCandidates(options);
  let best: RouteCandidate | undefined;
  for (const candidate of candidates) {
    if (candidate.collisionCount !== 0) {
      continue;
    }
    if (best === undefined || compareRouteCandidates(candidate, best) < 0) {
      best = candidate;
    }
  }
  return best ?? null;
}

function formatCoordinate(value: number): string {
  const rounded = Math.abs(value) < 0.0001 ? 0 : Number(value.toFixed(3));
  return String(rounded);
}

/** Converts a route into a rounded orthogonal SVG path without moving either endpoint. */
export function routeToSmoothSvgPath(points: readonly RoutePoint[]): string {
  const route = simplifyOrthogonalPoints(points);
  if (route.length === 0) {
    return "";
  }
  if (route.length === 1) {
    return `M${formatCoordinate(route[0]!.x)},${formatCoordinate(route[0]!.y)}`;
  }

  let path = `M${formatCoordinate(route[0]!.x)},${formatCoordinate(route[0]!.y)}`;
  for (let index = 1; index < route.length - 1; index += 1) {
    const before = route[index - 1]!;
    const corner = route[index]!;
    const after = route[index + 1]!;
    const incomingLength = Math.hypot(corner.x - before.x, corner.y - before.y);
    const outgoingLength = Math.hypot(after.x - corner.x, after.y - corner.y);
    const radius = Math.min(CORNER_RADIUS, incomingLength / 2, outgoingLength / 2);
    if (radius <= 0) {
      path += ` L${formatCoordinate(corner.x)},${formatCoordinate(corner.y)}`;
      continue;
    }
    const incoming = { x: (corner.x - before.x) / incomingLength, y: (corner.y - before.y) / incomingLength };
    const outgoing = { x: (after.x - corner.x) / outgoingLength, y: (after.y - corner.y) / outgoingLength };
    const curveStart = { x: corner.x - incoming.x * radius, y: corner.y - incoming.y * radius };
    const curveEnd = { x: corner.x + outgoing.x * radius, y: corner.y + outgoing.y * radius };
    path += ` L${formatCoordinate(curveStart.x)},${formatCoordinate(curveStart.y)}`
      + ` Q${formatCoordinate(corner.x)},${formatCoordinate(corner.y)} ${formatCoordinate(curveEnd.x)},${formatCoordinate(curveEnd.y)}`;
  }
  const last = route.at(-1)!;
  path += ` L${formatCoordinate(last.x)},${formatCoordinate(last.y)}`;
  return path;
}

/** Finds the label position at half the route's unrounded polyline length. */
export function routeLabelPoint(points: readonly RoutePoint[]): RoutePoint {
  const route = simplifyOrthogonalPoints(points);
  if (route.length === 0) {
    return { x: 0, y: 0 };
  }
  const total = pathLength(route);
  if (total === 0) {
    return route[0]!;
  }
  let remaining = total / 2;
  for (let index = 1; index < route.length; index += 1) {
    const start = route[index - 1]!;
    const end = route[index]!;
    const segmentLength = Math.hypot(end.x - start.x, end.y - start.y);
    if (remaining <= segmentLength) {
      const ratio = remaining / segmentLength;
      return { x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio };
    }
    remaining -= segmentLength;
  }
  return route.at(-1)!;
}
