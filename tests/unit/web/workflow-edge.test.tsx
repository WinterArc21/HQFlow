import "@testing-library/jest-dom/vitest";
import { fireEvent, render, type RenderResult } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getBezierPath, Position, ReactFlowProvider, type EdgeProps } from "@xyflow/react";
import type { WorkflowConnection } from "@schema/workflow";
import { buildFlowEdges } from "@web/components/canvas/buildFlowElements";
import { WorkflowEdge } from "@web/components/canvas/edges/WorkflowEdge";
import type { WorkflowEdgeData, WorkflowFlowEdge } from "@web/components/canvas/types";
import type { LayoutResult } from "@web/components/canvas/layout";

/**
 * `WorkflowEdge` is exercised directly (mirroring `canvas-node.test.tsx`'s approach for nodes):
 * it only reads `data` and the position props React Flow would normally supply, so a
 * `ReactFlowProvider` ancestor is enough for its `BaseEdge`/`EdgeLabelRenderer` internals to run
 * without a full `<ReactFlow>` tree and the real layout measurement jsdom cannot provide.
 */
function renderEdge(data: WorkflowEdgeData, id = "e1"): HTMLElement {
  const props = {
    id,
    type: "workflow",
    source: "a",
    target: "b",
    sourceX: 0,
    sourceY: 0,
    targetX: 0,
    targetY: 100,
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
    data,
  } as unknown as EdgeProps<WorkflowFlowEdge>;
  const { container } = render(
    <ReactFlowProvider>
      <svg><WorkflowEdge {...props} /></svg>
    </ReactFlowProvider>,
  );
  return container;
}

function renderInteractiveEdge(
  data: WorkflowEdgeData,
  coordinates: Partial<EdgeProps<WorkflowFlowEdge>> = {},
): RenderResult {
  const props = {
    id: "e1",
    type: "workflow",
    source: "a",
    target: "b",
    sourceX: 0,
    sourceY: 0,
    targetX: 100,
    targetY: 100,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    data,
    ...coordinates,
  } as EdgeProps<WorkflowFlowEdge>;
  return render(
    <ReactFlowProvider>
      <svg><WorkflowEdge {...props} /></svg>
    </ReactFlowProvider>,
  );
}

function makeConnection(overrides: Partial<WorkflowConnection> = {}): WorkflowConnection {
  return { from: "a", to: "b", ...overrides };
}

function makeData(overrides: Partial<WorkflowEdgeData> = {}): WorkflowEdgeData {
  return { connection: makeConnection(), dimmed: false, traced: false, ...overrides };
}

function makeLayout(): LayoutResult {
  return {
    nodes: [
      { id: "a", x: 0, y: 0, width: 100, height: 80, index: 0, isOutcome: false },
      { id: "ordinary", x: 200, y: 0, width: 100, height: 80, index: 1, isOutcome: false },
      { id: "success", x: 200, y: 120, width: 100, height: 40, index: 2, isOutcome: true, outcomeBand: "success" },
      { id: "failure", x: 200, y: -120, width: 100, height: 40, index: 3, isOutcome: true, outcomeBand: "failure" },
    ],
    edges: [
      { id: "ordinary-edge", source: "a", target: "ordinary", connection: makeConnection({ to: "ordinary", type: "success" }) },
      { id: "success-edge", source: "a", target: "success", connection: makeConnection({ to: "success", type: "success" }) },
      { id: "failure-edge", source: "a", target: "failure", connection: makeConnection({ to: "failure", type: "success" }) },
    ],
    bounds: { minX: 0, minY: -120, maxX: 300, maxY: 160, width: 300, height: 280 },
  };
}

/** The semantic stroke is the BaseEdge path (`react-flow__edge-path`); the halo is the plain
 * `<path>` underlay rendered before it (no edge-path/edge-interaction class). BaseEdge may also
 * emit an invisible interaction path — both are filtered out when locating the halo. */
function edgePaths(container: HTMLElement): { semantic: SVGPathElement; halo: SVGPathElement } {
  const group = container.querySelector(`[data-workflow-edge="${"e1"}"]`);
  expect(group).not.toBeNull();
  const paths = Array.from(group!.querySelectorAll("path"));
  const semantic = paths.find((p) => p.classList.contains("react-flow__edge-path"));
  const halo = paths.find(
    (p) => !p.classList.contains("react-flow__edge-path") && !p.classList.contains("react-flow__edge-interaction"),
  );
  expect(semantic, "semantic edge-path not rendered").toBeDefined();
  expect(halo, "halo underlay path not rendered").toBeDefined();
  return { semantic: semantic!, halo: halo! };
}

describe("WorkflowEdge visual grammar", () => {
  describe("manual bends", () => {
    it("keeps the ordinary default path unchanged before interaction", () => {
      const result = renderInteractiveEdge(makeData());
      const expected = getBezierPath({
        sourceX: 0,
        sourceY: 0,
        targetX: 100,
        targetY: 100,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        curvature: 0.35,
      })[0];

      expect(edgePaths(result.container).semantic.getAttribute("d")).toBe(expected);
      expect(result.getByRole("button", { name: "Bend edge e1" })).toBeInTheDocument();
    });

    it("draws a smooth curve through a freely dragged bend point", () => {
      const result = renderInteractiveEdge(makeData());
      const handle = result.getByRole("button", { name: "Bend edge e1" });

      fireEvent.pointerDown(handle, { pointerId: 1, clientX: 50, clientY: 50 });
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 40, clientY: 55 });
      fireEvent.pointerUp(handle, { pointerId: 1 });

      const path = edgePaths(result.container).semantic.getAttribute("d");
      expect(path).toContain(" C");
      expect(path).toContain(" 40,55 C");
      expect(path).toMatch(/^M0,0 L18,0 /);
      expect(path).toMatch(/ 63\.25,100 82,100 L100,100$/);
      expect(handle).toHaveAttribute("data-snapped", "false");
    });

    it("snaps near either valid orthogonal corner to a straight elbow", () => {
      const result = renderInteractiveEdge(makeData());
      const handle = result.getByRole("button", { name: "Bend edge e1" });

      fireEvent.pointerDown(handle, { pointerId: 1 });
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 4, clientY: 96 });
      fireEvent.pointerUp(handle, { pointerId: 1 });

      expect(edgePaths(result.container).semantic.getAttribute("d")).toBe("M0,0 L0,100 L100,100");
      expect(handle).toHaveAttribute("data-snapped", "true");
    });

    it("does not offer a bend handle for branch, retry, or return edges", () => {
      for (const exclusion of [{ branch: true }, { retry: true }, { returnEdge: true }]) {
        const result = renderInteractiveEdge(makeData(exclusion));
        expect(result.queryByRole("button", { name: "Bend edge e1" })).not.toBeInTheDocument();
        result.unmount();
      }
    });

    it("resets a manual bend when the generated layout reset key changes", () => {
      const firstData = makeData({ bendResetKey: "layout-1" });
      const result = renderInteractiveEdge(firstData);
      const handle = result.getByRole("button", { name: "Bend edge e1" });
      fireEvent.pointerDown(handle, { pointerId: 1 });
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 40, clientY: 55 });
      fireEvent.pointerUp(handle, { pointerId: 1 });
      expect(edgePaths(result.container).semantic.getAttribute("d")).toContain(" 40,55 C");

      result.rerender(
        <ReactFlowProvider>
          <svg>
            <WorkflowEdge
              {...({
                id: "e1", type: "workflow", source: "a", target: "b",
                sourceX: 0, sourceY: 0, targetX: 100, targetY: 100,
                sourcePosition: Position.Right, targetPosition: Position.Left,
                data: makeData({ bendResetKey: "layout-2" }),
              } as EdgeProps<WorkflowFlowEdge>)}
            />
          </svg>
        </ReactFlowProvider>,
      );

      expect(edgePaths(result.container).semantic.getAttribute("d")).toBe(getBezierPath({
        sourceX: 0, sourceY: 0, targetX: 100, targetY: 100,
        sourcePosition: Position.Right, targetPosition: Position.Left, curvature: 0.35,
      })[0]);
    });

    it("keeps a manual bend while live node movement updates its endpoint", () => {
      const data = makeData({ bendResetKey: "same-layout" });
      const result = renderInteractiveEdge(data);
      const handle = result.getByRole("button", { name: "Bend edge e1" });
      fireEvent.pointerDown(handle, { pointerId: 1 });
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 40, clientY: 55 });
      fireEvent.pointerUp(handle, { pointerId: 1 });

      result.rerender(
        <ReactFlowProvider>
          <svg>
            <WorkflowEdge
              {...({
                id: "e1", type: "workflow", source: "a", target: "b",
                sourceX: 0, sourceY: 0, targetX: 140, targetY: 120,
                sourcePosition: Position.Right, targetPosition: Position.Left, data,
              } as EdgeProps<WorkflowFlowEdge>)}
            />
          </svg>
        </ReactFlowProvider>,
      );

      const movedPath = edgePaths(result.container).semantic.getAttribute("d");
      expect(movedPath).toContain(" 40,55 C");
      expect(movedPath).toMatch(/L140,120$/);
    });
  });

  describe("stroke width per connection type", () => {
    it("renders primary edges at 2.75px and every branch edge at 2px", () => {
      expect(edgePaths(renderEdge(makeData({ connection: makeConnection({ type: "success" }) }))).semantic.style.strokeWidth).toBe("2.75");
      expect(edgePaths(renderEdge(makeData({ connection: makeConnection() }))).semantic.style.strokeWidth).toBe("2.75");
      for (const type of ["failure", "conditional"] as const) {
        const { semantic } = edgePaths(renderEdge(makeData({ connection: makeConnection({ type }) })));
        expect(semantic.style.strokeWidth, type).toBe("2");
      }
      expect(edgePaths(renderEdge(makeData({ connection: makeConnection({ type: "async" }) }))).semantic.style.strokeWidth).toBe("2");
      const retry = edgePaths(
        renderEdge(
          makeData({
            connection: makeConnection({ from: "a", to: "a", type: "conditional", label: "retry" }),
            retry: true,
          }),
        ),
      );
      expect(retry.semantic.style.strokeWidth).toBe("2");
    });
  });

  describe("dash patterns", () => {
    it("uses 8 6 dashes for failure/conditional/retry", () => {
      for (const type of ["failure", "conditional"] as const) {
        const { semantic } = edgePaths(renderEdge(makeData({ connection: makeConnection({ type }) })));
        expect(semantic.style.strokeDasharray, type).toBe("8 6");
      }
      const { semantic: retry } = edgePaths(
        renderEdge(
          makeData({
            connection: makeConnection({ from: "a", to: "a", type: "conditional", label: "retry" }),
            retry: true,
          }),
        ),
      );
      expect(retry.style.strokeDasharray).toBe("8 6");
    });

    it("uses the correct async and success stroke patterns", () => {
      const { semantic } = edgePaths(renderEdge(makeData({ connection: makeConnection({ type: "async" }) })));
      expect(semantic.style.strokeDasharray).toBe("1 6");
      expect(semantic.style.strokeLinecap).toBe("round");
      const success = edgePaths(renderEdge(makeData({ connection: makeConnection({ type: "success" }) }))).semantic;
      expect(success.style.strokeDasharray).toBe("");
      expect(success.style.strokeLinecap).toBe("round");
    });

    it("renders a terminal success edge as dashed green while ordinary success stays solid", () => {
      const edges = buildFlowEdges(makeLayout(), new Set(), null);
      const ordinary = edges[0]!;
      const success = edges[1]!;
      const ordinaryPaths = edgePaths(renderEdge(ordinary.data!));
      const successPaths = edgePaths(renderEdge(success.data!, "e1"));

      expect(ordinary.data?.outcomeBand).toBeUndefined();
      expect(success.data?.outcomeBand).toBe("success");
      expect(ordinaryPaths.semantic.style.stroke).toBe("var(--accent-neutral)");
      expect(ordinaryPaths.semantic.style.strokeDasharray).toBe("");
      expect(successPaths.semantic.style.stroke).toBe("var(--accent-output)");
      expect(successPaths.semantic.style.strokeDasharray).toBe("8 6");
      expect(successPaths.semantic.getAttribute("marker-end")).toBe("url(#codehq-arrow-success-outcome)");
    });

    it("uses the terminal target band for a failure marker even when its connection type is success", () => {
      const failure = buildFlowEdges(makeLayout(), new Set(), null)[2]!;
      const { semantic } = edgePaths(renderEdge(failure.data!));

      expect(failure.data?.outcomeBand).toBe("failure");
      expect(semantic.style.stroke).toBe("var(--accent-red)");
      expect(semantic.style.strokeDasharray).toBe("8 6");
      expect(semantic.getAttribute("marker-end")).toBe("url(#codehq-arrow-failure)");
    });
  });

  describe("resting opacity and path tracing", () => {
    it("renders every resting edge fully and dims unrelated traced paths", () => {
      for (const type of ["success", "failure", "conditional", "async"] as const) {
        const { semantic } = edgePaths(renderEdge(makeData({ connection: makeConnection({ type }) })));
        expect(semantic.style.opacity, type).toBe("1");
      }
      const { semantic, halo } = edgePaths(renderEdge(makeData({ connection: makeConnection({ type: "failure" }), dimmed: true })));
      expect(semantic.style.opacity).toBe("0.25");
      expect(halo.style.opacity).toBe("0.25");
    });

    it("strengthens a traced edge's stroke by 1px without dimming it", () => {
      const { semantic, halo } = edgePaths(
        renderEdge(makeData({ connection: makeConnection({ type: "success" }), traced: true })),
      );
      expect(semantic.style.strokeWidth).toBe("3.75");
      expect(semantic.style.opacity).toBe("1");
      // The halo grows with the semantic stroke so the casing stays proportionate.
      expect(halo.style.strokeWidth).toBe("7.75");
    });

  });

  describe("edge casing / halo", () => {
    it("paints a non-interactive background underlay without stealing the arrowhead", () => {
      const { semantic, halo } = edgePaths(renderEdge(makeData({ connection: makeConnection({ type: "failure" }) })));
      expect(halo.getAttribute("fill")).toBe("none");
      expect(halo.style.stroke).toBe("var(--bg-canvas)");
      expect(Number(halo.style.strokeWidth)).toBe(Number(semantic.style.strokeWidth) + 4);
      expect(halo.style.pointerEvents).toBe("none");
      expect(semantic.getAttribute("marker-end")).toBe("url(#codehq-arrow-failure)");
      expect(halo.getAttribute("marker-end")).toBeNull();
    });
  });
});
