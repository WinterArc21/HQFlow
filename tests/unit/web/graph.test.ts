import { describe, expect, it } from "vitest";
import type { Workflow, WorkflowStep } from "@schema/workflow";
import {
  computeArrowNavigation,
  computeBackEdgeIds,
  computeIncomingTypes,
  computeOutcomeStepIds,
  computeOutDegree,
  computeTracePath,
} from "@web/components/canvas/graph";

function makeStep(id: string, overrides: Partial<WorkflowStep> = {}): WorkflowStep {
  return { id, name: `Step ${id}`, purpose: `Purpose of ${id}.`, ...overrides };
}

function makeWorkflow(steps: WorkflowStep[], connections: Workflow["connections"] = []): Workflow {
  return { schemaVersion: "0.1", id: "wf", name: "Workflow", purpose: "A test workflow.", steps, connections };
}

describe("canvas graph helpers", () => {
  it("computes valid out-degrees and terminal outcome ids", () => {
    const workflow = makeWorkflow(
      [
        makeStep("entry"),
        makeStep("out", { category: "output" }),
        makeStep("terminal"),
        makeStep("isolated", { category: "output" }),
        makeStep("continuing", { category: "output" }),
      ],
      [
        { from: "entry", to: "out" },
        { from: "entry", to: "terminal" },
        { from: "entry", to: "continuing" },
        { from: "continuing", to: "out" },
        { from: "missing", to: "isolated" },
        { from: "entry", to: "missing" },
      ],
    );
    const outDegree = computeOutDegree(workflow);
    expect(outDegree.get("entry")).toBe(3);
    expect(outDegree.get("out")).toBe(0);
    expect(computeOutcomeStepIds(workflow)).toEqual(new Set(["out"]));
  });

  it("provides directional navigation for pipelines, sibling lanes, and outcomes", () => {
    const pipeline = makeWorkflow(
      [
        makeStep("entry"),
        makeStep("guard"),
        makeStep("save"),
        makeStep("bad", { category: "output" }),
        makeStep("ok", { category: "output" }),
      ],
      [
        { from: "entry", to: "guard" },
        { from: "guard", to: "save" },
        { from: "guard", to: "bad", type: "failure" },
        { from: "save", to: "ok" },
      ],
    );
    expect(computeArrowNavigation(pipeline, "guard")).toEqual(expect.objectContaining({ right: "bad", down: "save" }));
    expect(computeArrowNavigation(pipeline, "bad").left).toBe("guard");

    const siblings = makeWorkflow(
      [makeStep("root"), makeStep("a"), makeStep("b")],
      [{ from: "root", to: "a" }, { from: "root", to: "b" }],
    );
    expect(computeArrowNavigation(siblings, "a").right).toBe("b");
    expect(computeArrowNavigation(siblings, "b").left).toBe("a");

    const outcomes = makeWorkflow(
      [makeStep("source"), makeStep("one", { category: "output" }), makeStep("two", { category: "output" })],
      [{ from: "source", to: "one", type: "failure" }, { from: "source", to: "two", type: "failure" }],
    );
    expect(computeArrowNavigation(outcomes, "one").down).toBe("two");
    expect(computeArrowNavigation(outcomes, "two").up).toBe("one");

    const seen = new Set(["entry"]);
    const queue = ["entry"];
    while (queue.length > 0) {
      for (const next of Object.values(computeArrowNavigation(pipeline, queue.shift()!))) {
        if (next && !seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    expect(seen).toEqual(new Set(pipeline.steps.map((step) => step.id)));
  });

  it("collects incoming connection types without manufacturing empty entries", () => {
    const workflow = makeWorkflow(
      [makeStep("a"), makeStep("b"), makeStep("outcome")],
      [{ from: "a", to: "outcome", type: "failure" }, { from: "b", to: "outcome", type: "failure" }],
    );
    const incoming = computeIncomingTypes(workflow);
    expect(incoming.get("outcome")).toEqual(["failure", "failure"]);
    expect(incoming.get("a")).toBeUndefined();
  });

  it("identifies self-loops and ancestor returns while leaving DAG edges alone", () => {
    expect(computeBackEdgeIds(makeWorkflow([makeStep("call")], [{ from: "call", to: "call" }]))).toEqual(
      new Set(["call->call#0"]),
    );
    expect(
      computeBackEdgeIds(makeWorkflow([makeStep("call")], [{ id: "retry-edge", from: "call", to: "call" }])),
    ).toEqual(new Set(["retry-edge"]));

    const cyclic = makeWorkflow(
      [makeStep("a"), makeStep("b"), makeStep("c")],
      [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "a" }],
    );
    expect(computeBackEdgeIds(cyclic)).toEqual(new Set(["c->a#2"]));
    const dag = makeWorkflow(
      [makeStep("a"), makeStep("b"), makeStep("c")],
      [{ from: "a", to: "b" }, { from: "a", to: "c" }, { from: "b", to: "c" }],
    );
    expect(computeBackEdgeIds(dag).size).toBe(0);
  });

  it("traces only the anchor's local neighborhood and outgoing edges", () => {
    const workflow = makeWorkflow(
      [makeStep("a"), makeStep("b"), makeStep("c"), makeStep("d"), makeStep("e")],
      [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "c", to: "d" },
        { from: "a", to: "e", type: "failure" },
      ],
    );
    const middle = computeTracePath(workflow, "b");
    expect(middle.stepIds).toEqual(new Set(["a", "b", "c"]));
    expect(middle.edgeIds).toEqual(new Set(["b->c#1"]));
    expect(computeTracePath(workflow, "a")).toEqual({
      stepIds: new Set(["a", "b", "e"]),
      edgeIds: new Set(["a->b#0", "a->e#3"]),
    });
    expect(computeTracePath(workflow, "d")).toEqual({ stepIds: new Set(["c", "d"]), edgeIds: new Set() });
    expect(computeTracePath(workflow, "not-a-real-step")).toEqual({ stepIds: new Set(), edgeIds: new Set() });
  });

  it("terminates tracing when the graph contains a cycle", () => {
    const cyclic = makeWorkflow(
      [makeStep("a"), makeStep("b"), makeStep("c")],
      [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "a" }],
    );
    const start = Date.now();
    const trace = computeTracePath(cyclic, "a");
    expect(Date.now() - start).toBeLessThan(2000);
    expect(trace.stepIds).toEqual(new Set(["c", "a", "b"]));
    expect(trace.edgeIds).toEqual(new Set(["a->b#0"]));
  });
});
