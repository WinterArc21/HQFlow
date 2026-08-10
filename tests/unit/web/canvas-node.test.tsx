import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ReactFlowProvider, type NodeProps } from "@xyflow/react";
import type { Workflow, WorkflowStep } from "@schema/workflow";
import { buildFlowEdges, buildFlowNodes, chooseCardinalHandles, restoreGeneratedNodePositions } from "@web/components/canvas/buildFlowElements";
import { CanvasLegend } from "@web/components/canvas/CanvasLegend";
import { CanvasOverflowIndicator } from "@web/components/canvas/CanvasOverflowIndicator";
import { computeBackEdgeIds } from "@web/components/canvas/graph";
import { computeLayout } from "@web/components/canvas/layout";
import { OutcomeNode } from "@web/components/canvas/nodes/OutcomeNode";
import { StepNode } from "@web/components/canvas/nodes/StepNode";
import type { OutcomeFlowNode, OutcomeNodeData, StepFlowNode, StepNodeData } from "@web/components/canvas/types";

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
    confidence: "verified",
    ...overrides,
  };
}

function makeData(overrides: Partial<StepNodeData> = {}): StepNodeData {
  return {
    step: makeStep(),
    index: 2,
    effectiveDepth: "workflow",
    expanded: false,
    selected: false,
    hasMissingSource: false,
    dimmed: false,
    tabIndex: -1,
    onToggleExpand: () => {},
    onKeyDown: () => {},
    onHoverStart: () => {},
    onHoverEnd: () => {},
    onFocusStep: () => {},
    onBlurStep: () => {},
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
  it("declares hidden anchors on every side for dynamic edge attachment", () => {
    const { container } = renderStepNode(makeProps(makeData()));
    for (const handleId of ["in", "in-right", "in-top", "in-bottom", "out", "out-left", "out-top", "out-bottom"]) {
      expect(container.querySelector(`[data-handleid="${handleId}"]`), handleId).toBeInTheDocument();
    }
  });

  it("renders the name, one-line purpose, category, and index when collapsed", () => {
    renderStepNode(makeProps(makeData()));
    expect(screen.getByText("Scrape Website")).toBeInTheDocument();
    expect(screen.getByText("Fetches the submitted pages and extracts useful text.")).toBeInTheDocument();
    expect(screen.getByText("Logic")).toBeInTheDocument();
    expect(screen.getByText("03")).toBeInTheDocument();
  });

  it("never badges confidence on the card, at any confidence level", () => {
    for (const confidence of ["verified", "inferred", "human-confirmed"] as const) {
      const { unmount } = renderStepNode(makeProps(makeData({ step: makeStep({ confidence }) })));
      expect(screen.queryByText(/^(Verified|Inferred|Human-confirmed)$/)).not.toBeInTheDocument();
      unmount();
    }
  });

  it("keeps confidence in the card's accessible name even though no badge shows it", () => {
    renderStepNode(makeProps(makeData({ step: makeStep({ confidence: "inferred" }) })));
    expect(screen.getByRole("button", { name: /inferred confidence/i })).toBeInTheDocument();
  });

  it("does not put source, edge-case, or test counts on the card", () => {
    const data = makeData({
      step: makeStep({
        sources: [{ file: "lib/scraper.ts", symbol: "scrapeWebsite" }],
        edgeCases: [{ name: "Website blocks automated requests" }],
        tests: [{ file: "tests/unit/lib/scraper.test.ts" }],
      }),
    });
    renderStepNode(makeProps(data));
    expect(screen.queryByText(/\d+ (source|edge case|test)/)).not.toBeInTheDocument();
  });

  it("renders no facts row at all when there are no inputs/outputs", () => {
    renderStepNode(makeProps(makeData()));
    expect(screen.queryByText("in")).not.toBeInTheDocument();
    expect(screen.queryByText("out")).not.toBeInTheDocument();
  });

  it("keeps inputs and outputs off the Story card", () => {
    const data = makeData({
      effectiveDepth: "workflow",
      step: makeStep({
        inputs: [{ name: "ScrapedWebsite" }],
        outputs: [{ name: "ProductContext" }],
      }),
    });
    renderStepNode(makeProps(data));
    expect(screen.queryByText("ScrapedWebsite")).not.toBeInTheDocument();
    expect(screen.queryByText("ProductContext")).not.toBeInTheDocument();
    expect(screen.queryByText("in")).not.toBeInTheDocument();
    expect(screen.queryByText("out")).not.toBeInTheDocument();
  });

  it("surfaces inputs and outputs on the Code map card", () => {
    const data = makeData({
      effectiveDepth: "modules",
      step: makeStep({
        inputs: [{ name: "ScrapedWebsite" }],
        outputs: [{ name: "ProductContext" }],
      }),
    });
    renderStepNode(makeProps(data));
    expect(screen.getByText("ScrapedWebsite")).toBeInTheDocument();
    expect(screen.getByText("ProductContext")).toBeInTheDocument();
    expect(screen.getByText("in")).toBeInTheDocument();
    expect(screen.getByText("out")).toBeInTheDocument();
  });

  it("lists distinct source files at Code map altitude", () => {
    const data = makeData({
      effectiveDepth: "modules",
      step: makeStep({
        sources: [
          { file: "lib/scraper.ts", symbol: "scrapeWebsite" },
          { file: "lib/validation.ts" },
        ],
      }),
    });
    renderStepNode(makeProps(data));
    expect(screen.getByText("Files")).toBeInTheDocument();
    expect(screen.getByText("scraper.ts")).toBeInTheDocument();
    expect(screen.getByText("validation.ts")).toBeInTheDocument();
  });

  it("caps the file list and shows a '+N more' line beyond the maximum", () => {
    const data = makeData({
      effectiveDepth: "modules",
      step: makeStep({
        sources: Array.from({ length: 7 }, (_, i) => ({ file: `lib/file-${i}.ts` })),
      }),
    });
    renderStepNode(makeProps(data));
    expect(screen.getByText("+2 more")).toBeInTheDocument();
  });

  it("has a real, accessible expand control that toggles", async () => {
    const onToggleExpand = vi.fn();
    renderStepNode(makeProps(makeData({ onToggleExpand })));
    const user = userEvent.setup();
    const button = screen.getByRole("button", { name: /expand scrape website/i });
    await user.click(button);
    expect(onToggleExpand).toHaveBeenCalledTimes(1);
  });

  it("exposes a 'collapse' accessible name once expanded", () => {
    renderStepNode(makeProps(makeData({ expanded: true })));
    expect(screen.getByRole("button", { name: /collapse scrape website/i })).toBeInTheDocument();
  });

  it("surfaces a missing-sources warning affordance when a source check is missing", () => {
    renderStepNode(makeProps(makeData({ hasMissingSource: true })));
    expect(screen.getByText("Missing sources")).toBeInTheDocument();
  });

  it("does not surface the warning affordance when nothing is missing", () => {
    renderStepNode(makeProps(makeData()));
    expect(screen.queryByText("Missing sources")).not.toBeInTheDocument();
  });
});

describe("chooseCardinalHandles", () => {
  const source = { x: 100, y: 100, width: 100, height: 80 };

  it.each([
    ["right", { x: 300, y: 100, width: 100, height: 80 }, { sourceHandle: "out", targetHandle: "in" }],
    ["left", { x: -100, y: 100, width: 100, height: 80 }, { sourceHandle: "out-left", targetHandle: "in-right" }],
    ["below", { x: 100, y: 300, width: 100, height: 80 }, { sourceHandle: "out-bottom", targetHandle: "in-top" }],
    ["above", { x: 100, y: -100, width: 100, height: 80 }, { sourceHandle: "out-top", targetHandle: "in-bottom" }],
  ])("uses facing sides when the target is %s", (_direction, target, expected) => {
    expect(chooseCardinalHandles(source, target)).toEqual(expected);
  });

  it("keeps horizontal anchors on an exact diagonal or overlapping centres", () => {
    expect(chooseCardinalHandles(source, { ...source, x: 200, y: 200 })).toEqual({
      sourceHandle: "out",
      targetHandle: "in",
    });
    expect(chooseCardinalHandles(source, source)).toEqual({ sourceHandle: "out", targetHandle: "in" });
  });
});

describe("canvas outcome and legend semantics", () => {
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
    const layout = computeLayout(workflow, { depth: "workflow", expandedStepIds: {} });
    const backEdgeIds = computeBackEdgeIds(workflow);
    const nodes = buildFlowNodes({
      workflow,
      layout,
      backEdgeIds,
      depth: "workflow",
      expandedStepIds: {},
      sourceChecks: {},
      selectedStepId: null,
      traceStepIds: null,
      getTabIndex: () => -1,
      onToggleExpand: () => {},
      onNodeKeyDown: () => {},
      onHoverStart: () => {},
      onHoverEnd: () => {},
      onFocusStep: () => {},
      onBlurStep: () => {},
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

  it.each([
    ["right", "More"],
    ["bottom", "More below"],
  ] as const)("keeps the %s overflow cue decorative", (direction, label) => {
    render(<CanvasOverflowIndicator direction={direction} />);

    expect(screen.getByText(label).closest("div")).toHaveAttribute("aria-hidden", "true");
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
    const layout = computeLayout(workflow, { depth: "workflow", expandedStepIds: {} });
    const [edge] = buildFlowEdges(layout, new Set<string>(), null);

    expect(edge).toMatchObject({
      sourceHandle: "success",
      targetHandle: "outcome-in",
      data: { branch: true },
    });
  });

  it.each([
    ["success", "success"],
    ["failure", "failure"],
  ] as const)("declares cardinal target anchors for a %s outcome", (_label, band) => {
    const data: OutcomeNodeData = {
      step: makeStep({ id: "done-" + band, name: "Done " + band }),
      tone: band,
      band,
      dimmed: false,
      tabIndex: -1,
      onKeyDown: () => {},
      onHoverStart: () => {},
      onHoverEnd: () => {},
      onFocusStep: () => {},
      onBlurStep: () => {},
    };
    const props = { ...makeProps(makeData()), id: data.step.id, type: "outcome", data } as NodeProps<OutcomeFlowNode>;
    const { container } = render(
      <ReactFlowProvider>
        <OutcomeNode {...props} />
      </ReactFlowProvider>,
    );
    for (const handleId of ["in", "in-right", "in-top", "in-bottom", "outcome-in"]) {
      expect(container.querySelector("[data-handleid=\"" + handleId + "\"]"), band + "/" + handleId).toBeInTheDocument();
    }
  });

  it("labels a neutral outcome honestly and does not render a success check", () => {
    const data: OutcomeNodeData = {
      step: makeStep({ id: "done", name: "Done", purpose: "Processing ended." }),
      tone: "neutral",
      band: "success",
      dimmed: false,
      tabIndex: -1,
      onKeyDown: () => {},
      onHoverStart: () => {},
      onHoverEnd: () => {},
      onFocusStep: () => {},
      onBlurStep: () => {},
    };
    const props = { ...makeProps(makeData()), id: "done", type: "outcome", data } as NodeProps<OutcomeFlowNode>;
    const { container } = render(
      <ReactFlowProvider>
        <OutcomeNode {...props} />
      </ReactFlowProvider>,
    );
    expect(screen.getByRole("button", { name: /outcome: done/i })).toBeInTheDocument();
    expect(container.querySelector('[data-outcome-glyph="neutral"]')).toBeInTheDocument();
  });

  it("lists only present connection types and adds Retry only for a self-loop", () => {
    render(
      <CanvasLegend
        workflow={{
          schemaVersion: "0.1",
          id: "loop",
          name: "Loop",
          purpose: "Tests legend grammar.",
          steps: [makeStep({ id: "a" }), makeStep({ id: "b" })],
          connections: [
            { from: "a", to: "b", type: "failure" },
            { from: "a", to: "a", type: "conditional" },
          ],
        }}
      />,
    );
    const legend = screen.getByRole("group", { name: /connection legend/i });
    expect(screen.getByRole("heading", { name: "Connections", level: 2 })).toBeInTheDocument();
    expect(legend).toHaveTextContent("Failure");
    expect(legend).toHaveTextContent("Retry");
    expect(legend).not.toHaveTextContent("Conditional");
    expect(legend).not.toHaveTextContent("Normal");
    expect(legend).not.toHaveTextContent("Async");
  });

  it("separates terminal success edges from ordinary success edges in the legend", () => {
    render(
      <CanvasLegend
        workflow={{
          schemaVersion: "0.1",
          id: "success-outcome",
          name: "Success outcome",
          purpose: "Tests terminal success grammar.",
          steps: [makeStep({ id: "source" }), makeStep({ id: "work" }), makeStep({ id: "done", category: "output" })],
          connections: [
            { from: "source", to: "work", type: "success" },
            { from: "work", to: "done", type: "success" },
          ],
        }}
      />,
    );
    const legend = screen.getByRole("group", { name: /connection legend/i });
    expect(legend).toHaveTextContent("Normal");
    expect(legend).toHaveTextContent("Success outcome");
  });
});
