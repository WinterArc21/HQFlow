import { describe, expect, it } from "vitest";
import { splitSharedSides } from "@web/components/canvas/buildFlowElements";
import type { WorkflowFlowEdge } from "@web/components/canvas/types";

const box = (x: number, y: number) => ({ x, y, width: 200, height: 100 });

function edge(source: string, target: string, sourceHandle: string, targetHandle: string): WorkflowFlowEdge {
  return { id: `${source}->${target}`, source, target, sourceHandle, targetHandle } as WorkflowFlowEdge;
}

describe("splitSharedSides", () => {
  it("splits a side that has both an arrival and a departure, ordered by the other cards", () => {
    // "mid" receives from "up" (above) and sends to "down" (below), both on its left side.
    const bounds = new Map([["mid", box(500, 200)], ["up", box(0, 0)], ["down", box(0, 400)], ["far", box(900, 200)]]);
    const edges = [
      edge("up", "mid", "out", "in"),
      edge("mid", "down", "out-left", "in-right"),
      edge("mid", "far", "out", "in"),
    ];
    const [arrival, departure, untouched] = splitSharedSides(edges, bounds);
    expect(arrival?.targetHandle).toBe("in@1");
    expect(departure?.sourceHandle).toBe("out-left@2");
    // Sides that are not shared keep their middle port and the edge object itself.
    expect(arrival?.sourceHandle).toBe("out");
    expect(untouched).toBe(edges[2]);

    // Swap the other cards: the departure's card is now above, so it takes the first slot.
    const swapped = new Map([...bounds, ["up", box(0, 400)], ["down", box(0, 0)]]);
    const [swappedArrival, swappedDeparture] = splitSharedSides(edges, swapped);
    expect(swappedArrival?.targetHandle).toBe("in@2");
    expect(swappedDeparture?.sourceHandle).toBe("out-left@1");
  });

  it("splits two departures on one side, ordered by their target cards", () => {
    // "src" sends to "low" (below) and "high" (above), both from its right side.
    const bounds = new Map([["src", box(0, 200)], ["low", box(500, 400)], ["high", box(500, 0)]]);
    const edges = [edge("src", "low", "out", "in"), edge("src", "high", "out", "in")];
    const [toLow, toHigh] = splitSharedSides(edges, bounds);
    expect(toHigh?.sourceHandle).toBe("out@1");
    expect(toLow?.sourceHandle).toBe("out@2");
    // Each target receives one edge only, so its arrival port stays in the middle.
    expect(toLow?.targetHandle).toBe("in");
    expect(toHigh?.targetHandle).toBe("in");
  });

  it("keeps two arrivals on one side merged, so a fan-in reads as one join", () => {
    const bounds = new Map([["dst", box(500, 200)], ["low", box(0, 400)], ["high", box(0, 0)]]);
    const edges = [edge("low", "dst", "out", "in"), edge("high", "dst", "out", "in")];
    expect(splitSharedSides(edges, bounds)).toBe(edges);
  });

  it("returns the same array when no side is shared", () => {
    const edges = [edge("a", "b", "out", "in")];
    expect(splitSharedSides(edges, new Map([["a", box(0, 0)], ["b", box(400, 0)]]))).toBe(edges);
  });
});
