import { describe, expect, it } from "vitest";
import {
  EDGE_OBSTACLE_CLEARANCE,
  chooseObstacleAwareRoute,
  compareRouteCandidates,
  inflateObstacle,
  routeCollisionCount,
  type RouteCandidate,
  type RouteObstacle,
} from "@web/components/canvas/edges/obstacleRouting";

const blocker: RouteObstacle = { id: "blocker", x: 100, y: 100, width: 120, height: 80 };

function candidate(overrides: Partial<RouteCandidate>): RouteCandidate {
  return {
    points: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
    collisionCount: 0,
    length: 10,
    turnCount: 0,
    sidePreference: 0,
    order: 0,
    ...overrides,
  };
}

describe("obstacle-aware edge geometry", () => {
  it("inflates cards and treats crossing or touching the inflated rectangle as a collision", () => {
    const inflated = inflateObstacle(blocker);

    expect(inflated).toEqual({ id: "blocker", x: 80, y: 80, width: 160, height: 120 });
    expect(routeCollisionCount([{ x: 0, y: 140 }, { x: 320, y: 140 }], [blocker])).toBe(1);
    expect(routeCollisionCount([{ x: 0, y: 78 }, { x: 320, y: 78 }], [blocker])).toBe(0);
    expect(routeCollisionCount([{ x: 80, y: 0 }, { x: 80, y: 320 }], [blocker])).toBe(1);
    expect(EDGE_OBSTACLE_CLEARANCE).toBe(20);
  });

  it("ranks candidates in the approved lexicographic order", () => {
    const blockedShort = candidate({ collisionCount: 1, length: 10 });
    const clearLong = candidate({ collisionCount: 0, length: 100 });
    expect(compareRouteCandidates(clearLong, blockedShort)).toBeLessThan(0);

    const shortManyTurns = candidate({ length: 100, turnCount: 3 });
    const longFewTurns = candidate({ length: 101, turnCount: 1 });
    expect(compareRouteCandidates(shortManyTurns, longFewTurns)).toBeLessThan(0);

    const manyTurns = candidate({ length: 100, turnCount: 3, sidePreference: 0 });
    const fewTurns = candidate({ length: 100, turnCount: 2, sidePreference: 1 });
    expect(compareRouteCandidates(fewTurns, manyTurns)).toBeLessThan(0);

    const preferredSide = candidate({ length: 100, turnCount: 2, sidePreference: 0, order: 9 });
    const lessPreferredSide = candidate({ length: 100, turnCount: 2, sidePreference: 1, order: 0 });
    expect(compareRouteCandidates(preferredSide, lessPreferredSide)).toBeLessThan(0);

    const first = candidate({ order: 1 });
    const second = candidate({ order: 2 });
    expect(compareRouteCandidates(first, second)).toBeLessThan(0);
  });

  it("selects the same clear route for repeated live-position updates", () => {
    const options = {
      source: { x: 0, y: 140 },
      target: { x: 420, y: 140 },
      sourcePosition: "right" as const,
      targetPosition: "left" as const,
      obstacles: [
        { id: "source", x: -80, y: 80, width: 80, height: 120 },
        blocker,
        { id: "target", x: 420, y: 80, width: 80, height: 120 },
      ],
      sourceId: "source",
      targetId: "target",
    };

    const first = chooseObstacleAwareRoute(options);
    const second = chooseObstacleAwareRoute({ ...options, obstacles: options.obstacles.map((obstacle) => ({ ...obstacle })) });
    expect(first).not.toBeNull();
    expect(second).toEqual(first);
    expect(routeCollisionCount(first!.points, [blocker])).toBe(0);
  });

  it("returns null when every bounded candidate is blocked, preserving the caller's fallback", () => {
    const route = chooseObstacleAwareRoute({
      source: { x: 0, y: 0 },
      target: { x: 100, y: 0 },
      sourcePosition: "right",
      targetPosition: "left",
      obstacles: [{ id: "closed", x: -1_000, y: -1_000, width: 2_000, height: 2_000 }],
    });

    expect(route).toBeNull();
  });
});
