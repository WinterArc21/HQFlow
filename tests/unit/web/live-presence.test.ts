import { describe, expect, it, vi } from "vitest";
import type { Workflow, WorkflowConnection, WorkflowStep } from "@schema/workflow";
import {
  applyPresenceToEdges,
  applyPresenceToNodes,
  buildPresenceView,
  createInitialPresenceState,
  finishPresenceOperation,
  flushPresence,
  presenceEdgeKey,
  projectPresenceGraph,
  reconcilePresence,
  runPresenceSession,
  selectNextOperation,
  startPresenceOperation,
  type PresenceDriver,
  type PresencePoint,
  type PresenceState,
} from "@web/components/canvas/livePresence";
import type { CanvasFlowNode, WorkflowFlowEdge } from "@web/components/canvas/types";

function makeStep(id: string, overrides: Partial<WorkflowStep> = {}): WorkflowStep {
  return { id, name: `Step ${id}`, purpose: `Purpose of ${id}.`, ...overrides };
}

function makeWorkflow(
  steps: WorkflowStep[],
  connections: WorkflowConnection[] = [],
  id = "wf",
): Workflow {
  return { schemaVersion: "0.1", id, name: "Workflow", purpose: "A test workflow.", steps, connections };
}

function positions(entries: Record<string, PresencePoint>): Map<string, PresencePoint> {
  return new Map(Object.entries(entries));
}

function seeded(workflow: Workflow, flush = false): PresenceState {
  const graph = projectPresenceGraph(workflow);
  return flush ? flushPresence(graph) : reconcilePresence(createInitialPresenceState(), graph);
}

describe("projectPresenceGraph", () => {
  it("gives duplicate endpoint pairs stable occurrence keys and keeps explicit ids", () => {
    const workflow = makeWorkflow(
      [makeStep("a"), makeStep("b")],
      [
        { from: "a", to: "b" },
        { from: "a", to: "b", id: "named" },
        { from: "a", to: "b" },
        { from: "missing", to: "b" },
      ],
    );
    const graph = projectPresenceGraph(workflow);
    expect(graph.edges.map((edge) => edge.key)).toEqual([
      "pair:a->b#0",
      "id:named",
      "pair:a->b#1",
    ]);
    expect(graph.edges[1]?.renderId).toBe("named");
    expect(presenceEdgeKey({ from: "a", to: "b" }, 2)).toBe("pair:a->b#2");
  });

  it("keeps unlabeled pair keys stable when a named connection is inserted", () => {
    const before = projectPresenceGraph(makeWorkflow(
      [makeStep("a"), makeStep("b")],
      [{ from: "a", to: "b" }, { from: "a", to: "b" }],
    ));
    const after = projectPresenceGraph(makeWorkflow(
      [makeStep("a"), makeStep("b")],
      [{ from: "a", to: "b" }, { from: "a", to: "b", id: "named" }, { from: "a", to: "b" }],
    ));
    expect(before.edges.map((edge) => edge.key)).toEqual(["pair:a->b#0", "pair:a->b#1"]);
    expect(after.edges.map((edge) => edge.key)).toEqual(["pair:a->b#0", "id:named", "pair:a->b#1"]);
  });
});

describe("reconcilePresence", () => {
  it("makes the initial graph fully visible with no queued work", () => {
    const state = seeded(makeWorkflow([makeStep("a"), makeStep("b")], [{ from: "a", to: "b" }]));
    expect(state.pendingNodeIds).toEqual([]);
    expect(state.pendingEdgeKeys).toEqual([]);
    expect(state.visibleNodeIds).toEqual(["a", "b"]);
    expect(state.visibleEdgeKeys).toEqual(["pair:a->b#0"]);
    expect(state.active).toBeNull();
    expect(selectNextOperation(state, positions({ a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }))).toBeNull();
  });

  it("queues added nodes and edges, and ignores metadata, rename, and reorder", () => {
    const initial = makeWorkflow(
      [makeStep("a"), makeStep("b")],
      [{ from: "a", to: "b", id: "ab" }, { from: "b", to: "a", id: "ba" }],
    );
    let state = seeded(initial);

    const renamed = makeWorkflow(
      [makeStep("a", { name: "Alpha" }), makeStep("b", { purpose: "Changed." })],
      [{ from: "b", to: "a", id: "ba" }, { from: "a", to: "b", id: "ab" }],
    );
    state = reconcilePresence(state, projectPresenceGraph(renamed));
    expect(state.pendingNodeIds).toEqual([]);
    expect(state.pendingEdgeKeys).toEqual([]);

    const added = makeWorkflow(
      [...renamed.steps, makeStep("c")],
      [...renamed.connections, { from: "b", to: "c" }],
    );
    state = reconcilePresence(state, projectPresenceGraph(added));
    expect(state.pendingNodeIds).toEqual(["c"]);
    expect(state.pendingEdgeKeys).toEqual(["pair:b->c#0"]);
    expect(state.visibleNodeIds).toEqual(["a", "b"]);
  });

  it("drops removed pending work and keeps still-valid pending work on a later snapshot", () => {
    const base = seeded(makeWorkflow([makeStep("a")]));
    const withExtras = makeWorkflow(
      [makeStep("a"), makeStep("gone"), makeStep("stay")],
      [{ from: "a", to: "gone" }, { from: "a", to: "stay" }],
    );
    let state = reconcilePresence(base, projectPresenceGraph(withExtras));
    expect(state.pendingNodeIds).toEqual(["gone", "stay"]);

    const repaired = makeWorkflow(
      [makeStep("a"), makeStep("stay"), makeStep("new")],
      [{ from: "a", to: "stay" }, { from: "a", to: "new" }],
    );
    state = reconcilePresence(state, projectPresenceGraph(repaired));
    expect(state.pendingNodeIds).toEqual(["stay", "new"]);
    expect(state.pendingEdgeKeys).toEqual(["pair:a->stay#0", "pair:a->new#0"]);
  });

  it("does not preempt a still-valid active operation", () => {
    const base = seeded(makeWorkflow([makeStep("a")]));
    let state = reconcilePresence(base, projectPresenceGraph(makeWorkflow([makeStep("a"), makeStep("b")])));
    const operation = selectNextOperation(state, positions({ a: { x: 0, y: 0 }, b: { x: 80, y: 0 } }));
    expect(operation).toEqual({ kind: "node", id: "b", order: 1 });
    state = startPresenceOperation(state, operation!);

    state = reconcilePresence(state, projectPresenceGraph(makeWorkflow([makeStep("a"), makeStep("b"), makeStep("c")])));
    expect(state.active).toEqual(operation);
    expect(state.pendingNodeIds).toEqual(["b", "c"]);
    expect(selectNextOperation(state, positions({ a: { x: 0, y: 0 }, b: { x: 80, y: 0 }, c: { x: 10, y: 0 } }))).toBeNull();
  });

  it("cancels an active operation whose entity disappeared", () => {
    const base = seeded(makeWorkflow([makeStep("a")]));
    let state = reconcilePresence(base, projectPresenceGraph(makeWorkflow([makeStep("a"), makeStep("b")])));
    state = startPresenceOperation(state, { kind: "node", id: "b", order: 1 });
    state = reconcilePresence(state, projectPresenceGraph(makeWorkflow([makeStep("a")])));
    expect(state.active).toBeNull();
    expect(state.pendingNodeIds).toEqual([]);
  });

  it("flushes immediately on a workflow switch", () => {
    const first = seeded(makeWorkflow([makeStep("a")]));
    const pending = reconcilePresence(first, projectPresenceGraph(makeWorkflow([makeStep("a"), makeStep("b")])));
    const switched = reconcilePresence(pending, projectPresenceGraph(makeWorkflow([makeStep("x"), makeStep("y")], [], "other")));
    expect(switched.pendingNodeIds).toEqual([]);
    expect(switched.visibleNodeIds).toEqual(["x", "y"]);
    expect(switched.active).toBeNull();
  });

  it("flushes pending work for export mode and reduced motion", () => {
    const first = seeded(makeWorkflow([makeStep("a")]));
    const pending = reconcilePresence(first, projectPresenceGraph(makeWorkflow([makeStep("a"), makeStep("b")])));
    const flushed = reconcilePresence(pending, pending.graph, { flush: true });
    expect(flushed.pendingNodeIds).toEqual([]);
    expect(flushed.visibleNodeIds).toEqual(["a", "b"]);
    expect(flushed.active).toBeNull();
  });
});

describe("selectNextOperation", () => {
  it("picks the shortest travel and uses declaration order then key for ties", () => {
    const state = reconcilePresence(
      seeded(makeWorkflow([makeStep("origin")])),
      projectPresenceGraph(makeWorkflow([
        makeStep("origin"),
        makeStep("near"),
        makeStep("far"),
        makeStep("also-near"),
      ])),
    );
    const next = selectNextOperation(
      state,
      positions({
        origin: { x: 0, y: 0 },
        near: { x: 10, y: 0 },
        far: { x: 400, y: 0 },
        "also-near": { x: 10, y: 0 },
      }),
      { x: 0, y: 0 },
    );
    expect(next).toEqual({ kind: "node", id: "near", order: 1 });
  });

  it("waits until both edge endpoints are visible", () => {
    const state = reconcilePresence(
      seeded(makeWorkflow([makeStep("a")])),
      projectPresenceGraph(makeWorkflow([makeStep("a"), makeStep("b")], [{ from: "a", to: "b" }])),
    );
    const first = selectNextOperation(state, positions({ a: { x: 0, y: 0 }, b: { x: 80, y: 0 } }), { x: 0, y: 0 });
    expect(first).toEqual({ kind: "node", id: "b", order: 1 });

    const afterReveal = finishPresenceOperation(startPresenceOperation(state, first!), first!);
    const second = selectNextOperation(afterReveal, positions({ a: { x: 0, y: 0 }, b: { x: 80, y: 0 } }), { x: 80, y: 0 });
    expect(second).toMatchObject({ kind: "edge", key: "pair:a->b#0", source: "a", target: "b" });
  });

  it("does not start work until card positions are known", () => {
    const state = reconcilePresence(
      seeded(makeWorkflow([makeStep("a")])),
      projectPresenceGraph(makeWorkflow([makeStep("a"), makeStep("b")])),
    );
    expect(selectNextOperation(state, positions({ a: { x: 0, y: 0 } }))).toBeNull();
    expect(selectNextOperation(state, positions({ a: { x: 0, y: 0 }, b: { x: 80, y: 0 } }))).toEqual({
      kind: "node",
      id: "b",
      order: 1,
    });
  });
});

describe("presence view", () => {
  it("hides pending cards and marks pending or drawing edges", () => {
    const workflow = makeWorkflow([makeStep("a"), makeStep("b")], [{ from: "a", to: "b" }]);
    let state = reconcilePresence(seeded(makeWorkflow([makeStep("a")])), projectPresenceGraph(workflow));
    const hidden = applyPresenceToNodes(
      [
        { id: "a", type: "step", position: { x: 0, y: 0 }, data: { tabIndex: 0 } },
        { id: "b", type: "step", position: { x: 80, y: 0 }, data: { tabIndex: 0 } },
      ] as unknown as CanvasFlowNode[],
      buildPresenceView(state),
    );
    expect(hidden[0]?.style).toBeUndefined();
    expect(hidden[1]?.style).toMatchObject({ opacity: 0, visibility: "hidden", pointerEvents: "none" });
    expect(hidden[1]?.domAttributes).toMatchObject({ "data-presence-state": "pending" });
    expect(hidden[1]?.data.tabIndex).toBe(-1);

    const pendingEdges = applyPresenceToEdges(
      [{
        id: "a->b#0",
        source: "a",
        target: "b",
        data: { connection: { from: "a", to: "b" }, dimmed: false, traced: false },
      }] as WorkflowFlowEdge[],
      buildPresenceView(state),
    );
    expect(pendingEdges[0]?.data?.presence).toEqual({ phase: "pending", durationMs: 0, key: "pair:a->b#0" });

    state = startPresenceOperation(state, { kind: "edge", key: "pair:a->b#0", renderId: "a->b#0", source: "a", target: "b", order: 0 });
    state = { ...state, activePhase: "drawing", drawingDurationMs: 400, pendingNodeIds: [], visibleNodeIds: ["a", "b"] };
    const drawing = applyPresenceToEdges(pendingEdges, buildPresenceView(state));
    expect(drawing[0]?.data?.presence).toEqual({ phase: "drawing", durationMs: 400, key: "pair:a->b#0" });
    expect(drawing[0]?.domAttributes).toMatchObject({ "data-presence-state": "drawing" });
  });
});

describe("runPresenceSession", () => {
  it("reveals a node then draws its edge", async () => {
    const workflow = makeWorkflow([makeStep("a"), makeStep("b")], [{ from: "a", to: "b" }]);
    let state = reconcilePresence(seeded(makeWorkflow([makeStep("a")])), projectPresenceGraph(workflow));
    const calls: string[] = [];
    const driver: PresenceDriver = {
      async sleep(ms) {
        calls.push(`sleep:${ms}`);
      },
      async animateCursor(points, ms) {
        calls.push(`move:${Math.round(points[points.length - 1]?.x ?? 0)}:${ms}`);
      },
    };

    await runPresenceSession({
      getState: () => state,
      setState: (next) => {
        state = next;
      },
      getPositions: () => positions({ a: { x: 0, y: 0 }, b: { x: 80, y: 0 } }),
      getCursor: () => null,
      sampleEdge: () => ({ points: [{ x: 0, y: 0 }, { x: 80, y: 0 }], length: 80 }),
      driver,
      signal: new AbortController().signal,
    });

    expect(state.pendingNodeIds).toEqual([]);
    expect(state.pendingEdgeKeys).toEqual([]);
    expect(state.visibleNodeIds).toEqual(["a", "b"]);
    expect(state.visibleEdgeKeys).toEqual(["pair:a->b#0"]);
    expect(state.active).toBeNull();
    expect(calls.filter((call) => call.startsWith("move"))).toHaveLength(3);
    expect(calls).toContain("sleep:150");
  });

  it("aborts leftover driver work when the session signal fires", async () => {
    const workflow = makeWorkflow([makeStep("a"), makeStep("b")]);
    let state = reconcilePresence(seeded(makeWorkflow([makeStep("a")])), projectPresenceGraph(workflow));
    const controller = new AbortController();
    let abortSeen = false;
    const driver: PresenceDriver = {
      sleep(_ms, signal) {
        return new Promise((_resolve, reject) => {
          const fail = (): void => {
            abortSeen = true;
            reject(new DOMException("Aborted", "AbortError"));
          };
          if (signal.aborted) {
            fail();
            return;
          }
          signal.addEventListener("abort", fail, { once: true });
        });
      },
      async animateCursor() {},
    };

    const session = runPresenceSession({
      getState: () => state,
      setState: (next) => {
        state = next;
      },
      getPositions: () => positions({ a: { x: 0, y: 0 }, b: { x: 80, y: 0 } }),
      getCursor: () => ({ x: 0, y: 0 }),
      sampleEdge: () => null,
      driver,
      signal: controller.signal,
    });

    await vi.waitFor(() => {
      expect(state.active?.kind).toBe("node");
    });
    controller.abort();
    await session;
    expect(abortSeen).toBe(true);
    expect(state.visibleNodeIds).not.toContain("b");
  });
});
