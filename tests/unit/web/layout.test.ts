import { describe, expect, it } from "vitest";
import type { Workflow, WorkflowStep } from "@schema/workflow";
import { computeLayout, LAYOUT_RANK_SEP } from "@web/components/canvas/layout";

function makeStep(id: string, overrides: Partial<WorkflowStep> = {}): WorkflowStep {
  return { id, name: `Step ${id}`, purpose: `Purpose of ${id}.`, ...overrides };
}

function makeWorkflow(steps: WorkflowStep[], connections: Workflow["connections"] = []): Workflow {
  return {
    schemaVersion: "0.1",
    id: "wf",
    name: "Workflow",
    purpose: "A test workflow.",
    steps,
    connections,
  };
}

const BASE_OPTS = { expandedStepIds: {} };

function overlaps(a: { x: number; y: number; width: number; height: number }, b: typeof a): boolean {
  const separatedX = a.x + a.width <= b.x || b.x + b.width <= a.x;
  const separatedY = a.y + a.height <= b.y || b.y + b.height <= a.y;
  return !separatedX && !separatedY;
}

function expectNoOverlap(nodes: { id: string; x: number; y: number; width: number; height: number }[]): void {
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      if (a === undefined || b === undefined) continue;
      expect(overlaps(a, b), `${a.id} and ${b.id} overlap`).toBe(false);
    }
  }
}

describe("computeLayout", () => {
  it("is deterministic", () => {
    const workflow = makeWorkflow(
      [makeStep("a"), makeStep("b"), makeStep("done", { category: "output" })],
      [
        { from: "a", to: "b" },
        { from: "b", to: "done", type: "success" },
      ],
    );
    expect(computeLayout(workflow, BASE_OPTS)).toEqual(computeLayout(workflow, BASE_OPTS));
  });

  it("places the main workflow left-to-right on a shared horizontal centerline", () => {
    const workflow = makeWorkflow(
      [makeStep("entry", { category: "entry" }), makeStep("validate"), makeStep("persist"), makeStep("done", { category: "output" })],
      [
        { from: "entry", to: "validate" },
        { from: "validate", to: "persist", type: "success" },
        { from: "persist", to: "done", type: "success" },
      ],
    );
    const nodes = computeLayout(workflow, BASE_OPTS).nodes;
    const byId = new Map(nodes.map((node) => [node.id, node] as const));
    const work = [byId.get("entry")!, byId.get("validate")!, byId.get("persist")!];

    expect(work[0]!.x).toBeLessThan(work[1]!.x);
    expect(work[1]!.x).toBeLessThan(work[2]!.x);
    expect(work[1]!.x - (work[0]!.x + work[0]!.width)).toBe(LAYOUT_RANK_SEP);
    expect(work[2]!.x - (work[1]!.x + work[1]!.width)).toBe(LAYOUT_RANK_SEP);
    expect(new Set(work.map((node) => node.y + node.height / 2)).size).toBe(1);
    expectNoOverlap(nodes);
  });

  it("places failure outcomes above and successful outcomes below every work card", () => {
    const workflow = makeWorkflow(
      [
        makeStep("entry", { category: "entry" }),
        makeStep("validate", { category: "decision" }),
        makeStep("persist"),
        makeStep("rejected", { category: "output" }),
        makeStep("created", { category: "output" }),
      ],
      [
        { from: "entry", to: "validate" },
        { from: "validate", to: "persist", type: "success" },
        { from: "validate", to: "rejected", type: "failure", label: "invalid" },
        { from: "persist", to: "created", type: "success", label: "201" },
      ],
    );
    const nodes = computeLayout(workflow, BASE_OPTS).nodes;
    const work = nodes.filter((node) => !node.isOutcome);
    const rejected = nodes.find((node) => node.id === "rejected")!;
    const created = nodes.find((node) => node.id === "created")!;
    const top = Math.min(...work.map((node) => node.y));
    const bottom = Math.max(...work.map((node) => node.y + node.height));

    expect(rejected.outcomeBand).toBe("failure");
    expect(rejected.y + rejected.height).toBeLessThan(top);
    expect(created.outcomeBand).toBe("success");
    expect(created.y).toBeGreaterThan(bottom);
    expectNoOverlap(nodes);
  });

  it("stacks multiple outcomes in each semantic band without overlap", () => {
    const workflow = makeWorkflow(
      [
        makeStep("entry", { category: "entry" }),
        makeStep("work"),
        makeStep("fail-a", { category: "output" }),
        makeStep("fail-b", { category: "output" }),
        makeStep("success-a", { category: "output" }),
        makeStep("success-b", { category: "output" }),
      ],
      [
        { from: "entry", to: "work" },
        { from: "entry", to: "fail-a", type: "failure" },
        { from: "work", to: "fail-b", type: "failure" },
        { from: "work", to: "success-a", type: "success" },
        { from: "work", to: "success-b", type: "success" },
      ],
    );
    const nodes = computeLayout(workflow, BASE_OPTS).nodes;
    const failures = nodes.filter((node) => node.outcomeBand === "failure");
    const successes = nodes.filter((node) => node.outcomeBand === "success");

    expect(failures).toHaveLength(2);
    expect(successes).toHaveLength(2);
    expect(new Set(failures.map((node) => node.y)).size).toBe(1);
    expect(new Set(successes.map((node) => node.y)).size).toBe(1);
    expect(failures[0]!.x).toBeLessThan(failures[1]!.x);
    expect(successes[0]!.x).toBeLessThan(successes[1]!.x);
    expectNoOverlap(nodes);
  });

  it("keeps a single terminal non-output step as a work card", () => {
    const result = computeLayout(makeWorkflow([makeStep("only")]), BASE_OPTS);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]?.isOutcome).toBe(false);
  });

  it("keeps disconnected workflows deterministic and non-overlapping", () => {
    const workflow = makeWorkflow([makeStep("a"), makeStep("b"), makeStep("c")]);
    const result = computeLayout(workflow, BASE_OPTS);
    expect(result.nodes.map((node) => node.y + node.height / 2)).toEqual([
      result.nodes[0]!.y + result.nodes[0]!.height / 2,
      result.nodes[0]!.y + result.nodes[0]!.height / 2,
      result.nodes[0]!.y + result.nodes[0]!.height / 2,
    ]);
    expect(result.nodes[0]!.x).toBeLessThan(result.nodes[1]!.x);
    expect(result.nodes[1]!.x).toBeLessThan(result.nodes[2]!.x);
    expectNoOverlap(result.nodes);
  });

  it("grows detailed cards without moving them off the horizontal centerline", () => {
    const workflow = makeWorkflow(
      [
        makeStep("a", { sources: [{ file: "src/a.ts", symbol: "a" }] }),
        makeStep("b", { sources: [{ file: "src/b.ts", symbol: "b" }] }),
      ],
      [{ from: "a", to: "b" }],
    );
    const collapsed = computeLayout(workflow, { expandedStepIds: {} });
    const expanded = computeLayout(workflow, { expandedStepIds: { a: true } });
    const a = expanded.nodes.find((node) => node.id === "a")!;
    const b = expanded.nodes.find((node) => node.id === "b")!;

    expect(a.height).toBeGreaterThan(collapsed.nodes.find((node) => node.id === "a")!.height);
    expect(a.y + a.height / 2).toBe(b.y + b.height / 2);
    expectNoOverlap(expanded.nodes);
  });

  it("keeps a primary fork on the centerline and places its parallel sibling in a lower lane", () => {
    const workflow = makeWorkflow(
      [makeStep("start"), makeStep("fork"), makeStep("video"), makeStep("audio"), makeStep("join"), makeStep("done")],
      [
        { from: "start", to: "fork" },
        { from: "fork", to: "video", type: "success" },
        { from: "fork", to: "audio", type: "success" },
        { from: "video", to: "join", type: "success" },
        { from: "audio", to: "join", type: "success" },
        { from: "join", to: "done" },
      ],
    );
    const nodes = computeLayout(workflow, BASE_OPTS).nodes;
    const byId = new Map(nodes.map((node) => [node.id, node] as const));
    const center = byId.get("start")!.y + byId.get("start")!.height / 2;

    expect(byId.get("video")!.x).toBe(byId.get("audio")!.x);
    expect(byId.get("video")!.y + byId.get("video")!.height / 2).toBe(center);
    expect(byId.get("audio")!.y).toBeGreaterThan(byId.get("video")!.y + byId.get("video")!.height);
    expect(byId.get("join")!.y + byId.get("join")!.height / 2).toBe(center);
    expectNoOverlap(nodes);
  });

  it("terminates and remains non-overlapping for a cycle", () => {
    const workflow = makeWorkflow(
      [makeStep("a"), makeStep("b"), makeStep("c")],
      [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "c", to: "a", type: "conditional", label: "retry" },
      ],
    );
    const result = computeLayout(workflow, BASE_OPTS);
    expect(result.nodes).toHaveLength(3);
    expectNoOverlap(result.nodes);
  });
});
