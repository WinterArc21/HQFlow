import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReactFlowProvider, type NodeProps } from "@xyflow/react";
import type { Workflow, WorkflowStep } from "@schema/workflow";
import { buildFlowEdges, buildFlowNodes, chooseCardinalHandles, restoreGeneratedNodePositions } from "@web/components/canvas/buildFlowElements";
import { computeBackEdgeIds } from "@web/components/canvas/graph";
import { computeLayout } from "@web/components/canvas/layout";
import { StepNode } from "@web/components/canvas/nodes/StepNode";
import type { StepFlowNode, StepNodeData } from "@web/components/canvas/types";

/**
 * `StepNode` is tested in isolation from the full `WorkflowCanvas`/React Flow tree: React Flow
 * relies on real layout measurement (`ResizeObserver`, viewport sizing) that jsdom cannot
 * faithfully provide, but `StepNode` itself is a plain component that only reads `data` off the
 * `NodeProps` React Flow would normally supply — so it's exercised directly here. It still needs
 * a `ReactFlowProvider` ancestor: the node's `<Handle>` elements (required for edges to attach)
 * read from React Flow's store context even when rendered outside a full `<ReactFlow>` tree.
 */
function renderStepNode(props: NodeProps<StepFlowNode>) {
  return render(
    <ReactFlowProvider>
      <StepNode {...props} />
    </ReactFlowProvider>,
  );
}
function makeStep(overrides: Partial<WorkflowStep> = {}): WorkflowStep {
  return {
    id: "scrape-website",
    name: "Scrape Website",
    purpose: "Fetches the submitted pages and extracts useful text.",
    category: "logic",
    ...overrides,
  };
}

function makeData(overrides: Partial<StepNodeData> = {}): StepNodeData {
  return {
    step: makeStep(),
    index: 2,
    selected: false,
    hasMissingSource: false,
    dimmed: false,
    tabIndex: -1,
    onKeyDown: () => {},
    onHoverStart: () => {},
    onHoverEnd: () => {},
    ...overrides,
  };
}

function makeProps(data: StepNodeData): NodeProps<StepFlowNode> {
  return {
    id: data.step.id,
    data,
    type: "step",
    dragging: false,
    zIndex: 0,
    selectable: true,
    deletable: false,
    selected: data.selected,
    draggable: false,
    isConnectable: false,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
  };
}

describe("restoreGeneratedNodePositions", () => {
  it("restores generated positions while preserving current node state", () => {
    const current = [
      { id: "a", position: { x: 500, y: 600 }, selected: true },
      { id: "b", position: { x: 700, y: 800 }, selected: false },
    ];
    const generated = [
      { id: "a", position: { x: 10, y: 20 }, selected: false },
      { id: "b", position: { x: 30, y: 40 }, selected: false },
    ];

    expect(restoreGeneratedNodePositions(current, generated)).toEqual([
      { id: "a", position: { x: 10, y: 20 }, selected: true },
      { id: "b", position: { x: 30, y: 40 }, selected: false },
    ]);
  });
});

describe("StepNode", () => {
  it("shows the missing-source affordance only when needed", () => {
    const { unmount } = renderStepNode(makeProps(makeData({ hasMissingSource: true })));
    expect(screen.getByText("Missing sources")).toBeInTheDocument();
    unmount();
    renderStepNode(makeProps(makeData()));
    expect(screen.queryByText("Missing sources")).not.toBeInTheDocument();
  });
});

describe("chooseCardinalHandles", () => {
  const source = { x: 100, y: 100, width: 100, height: 80 };

  it("uses facing sides in every cardinal direction and horizontal ties", () => {
    const cases = [
    ["right", { x: 300, y: 100, width: 100, height: 80 }, { sourceHandle: "out", targetHandle: "in" }],
    ["left", { x: -100, y: 100, width: 100, height: 80 }, { sourceHandle: "out-left", targetHandle: "in-right" }],
    ["below", { x: 100, y: 300, width: 100, height: 80 }, { sourceHandle: "out-bottom", targetHandle: "in-top" }],
    ["above", { x: 100, y: -100, width: 100, height: 80 }, { sourceHandle: "out-top", targetHandle: "in-bottom" }],
    ] as const;
    for (const [direction, target, expected] of cases) {
      expect(chooseCardinalHandles(source, target), direction).toEqual(expected);
    }
    expect(chooseCardinalHandles(source, { ...source, x: 200, y: 200 })).toEqual({
      sourceHandle: "out",
      targetHandle: "in",
    });
    expect(chooseCardinalHandles(source, source)).toEqual({ sourceHandle: "out", targetHandle: "in" });
  });
});

describe("buildFlowElements", () => {
  it("preserves retry, return, and both outcome classifications in one preparation pass", () => {
    const workflow: Workflow = {
      schemaVersion: "0.1",
      id: "combined-edges",
      name: "Combined edges",
      purpose: "Exercises every special node connection flag together.",
      steps: [
        makeStep({ id: "first" }),
        makeStep({ id: "source" }),
        makeStep({ id: "success-outcome", category: "output" }),
        makeStep({ id: "failure-outcome", category: "output" }),
      ],
      connections: [
        { id: "forward", from: "first", to: "source", type: "success" },
        { id: "return", from: "source", to: "first", type: "conditional" },
        { id: "retry", from: "source", to: "source", type: "conditional" },
        { id: "success", from: "source", to: "success-outcome", type: "success" },
        { id: "failure", from: "source", to: "failure-outcome", type: "failure" },
      ],
    };
    const layout = computeLayout(workflow, {});
    const backEdgeIds = computeBackEdgeIds(workflow);
    const nodes = buildFlowNodes({
      workflow,
      layout,
      backEdgeIds,
      sourceChecks: {},
      selectedStepId: null,
      traceStepIds: null,
      getTabIndex: () => -1,
        onNodeKeyDown: () => {},
      onHoverStart: () => {},
      onHoverEnd: () => {},
    });
    const source = nodes.find((node) => node.id === "source");

    expect(source?.data).toMatchObject({
      hasFailureOutcome: true,
      hasSuccessOutcome: true,
      hasRetry: true,
      hasReturnOut: true,
    });
    expect(source?.handles?.map((handle) => handle.id)).toEqual(expect.arrayContaining([
      "failure",
      "success",
      "retry-in",
      "retry-out",
      "return-out",
    ]));
    expect(nodes.find((node) => node.id === "first")?.data).toMatchObject({ hasReturnIn: true });

    const edges = buildFlowEdges(layout, backEdgeIds, null);
    expect(edges.map((edge) => edge.id)).toEqual(["forward", "return", "retry", "success", "failure"]);
    expect(edges.find((edge) => edge.id === "return")?.data).toMatchObject({ returnEdge: true, retry: false });
    expect(edges.find((edge) => edge.id === "retry")?.data).toMatchObject({ returnEdge: false, retry: true });
    expect(edges.find((edge) => edge.id === "success")?.data).toMatchObject({ branch: true, outcomeBand: "success" });
    expect(edges.find((edge) => edge.id === "failure")?.data).toMatchObject({ branch: true, outcomeBand: "failure" });
  });
  it("keeps initial outcome edges on their semantic branch handles", () => {
    const workflow = {
      schemaVersion: "0.1" as const,
      id: "outcome-edge",
      name: "Outcome edge",
      purpose: "Tests outcome edge anchors.",
      steps: [makeStep({ id: "source" }), makeStep({ id: "done", category: "output" })],
      connections: [{ from: "source", to: "done", type: "success" as const }],
    };
    const layout = computeLayout(workflow, {});
    const [edge] = buildFlowEdges(layout, new Set<string>(), null);

    expect(edge).toMatchObject({
      sourceHandle: "success",
      targetHandle: "outcome-in",
      data: { branch: true },
    });
  });

  it("hangs a line-view outcome under its card when another card is in the way", () => {
    const workflow = {
      schemaVersion: "0.1" as const,
      id: "stacked",
      name: "Stacked",
      purpose: "Tests outcomes from a stacked column.",
      steps: [
        makeStep({ id: "split", category: "entry" }),
        makeStep({ id: "upper" }),
        makeStep({ id: "lower" }),
        makeStep({ id: "upper-failed", category: "output" }),
        makeStep({ id: "lower-failed", category: "output" }),
      ],
      connections: [
        { from: "split", to: "upper" },
        { from: "split", to: "lower" },
        { from: "upper", to: "upper-failed", type: "failure" as const, label: "timeout" },
        { from: "lower", to: "lower-failed", type: "failure" as const, label: "declined" },
      ],
    };
    const layout = computeLayout(workflow, { view: "line" });
    const node = (id: string) => layout.nodes.find((candidate) => candidate.id === id)!;
    const upper = node("upper");
    const lower = node("lower");
    expect(upper.x).toBe(lower.x);
    expect(upper.y).toBeLessThan(lower.y);

    // The top card's failure stays in the band above; the stacked card's hangs right under it.
    expect(node("upper-failed").y + node("upper-failed").height).toBeLessThanOrEqual(upper.y);
    expect(node("lower-failed").y).toBeGreaterThan(lower.y + lower.height);

    const edges = buildFlowEdges(layout, new Set<string>(), null);
    const edgeTo = (target: string) => edges.find((edge) => edge.target === target)!;
    expect(edgeTo("upper-failed")).toMatchObject({ sourceHandle: "failure", targetHandle: "outcome-in" });
    expect(edgeTo("lower-failed")).toMatchObject({ sourceHandle: "out-bottom", targetHandle: "in-top" });
    // The lower branch still connects side to side from the split, not down through "upper".
    expect(edgeTo("lower")).toMatchObject({ sourceHandle: "out", targetHandle: "in" });
  });

  it("fans out connections that share a source and target", () => {
    const workflow = {
      schemaVersion: "0.1" as const,
      id: "parallel",
      name: "Parallel",
      purpose: "Tests parallel edges.",
      steps: [makeStep({ id: "a", category: "entry" }), makeStep({ id: "b" })],
      connections: [
        { from: "a", to: "b", label: "one" },
        { from: "a", to: "b", label: "two" },
        { from: "a", to: "b", label: "three" },
      ],
    };
    const layout = computeLayout(workflow, {});

    const edges = buildFlowEdges(layout, new Set<string>(), null);

    expect(edges.map((edge) => edge.data?.parallelOffset)).toEqual([-1, undefined, 1]);
  });
});
