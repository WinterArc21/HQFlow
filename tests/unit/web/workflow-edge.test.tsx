import "@testing-library/jest-dom/vitest";
import { fireEvent, render, type RenderResult } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Position, ReactFlowProvider, type EdgeProps } from "@xyflow/react";
import type { WorkflowConnection } from "@schema/workflow";
import { arrowSafeBezierPath, WorkflowEdge } from "@web/components/canvas/edges/WorkflowEdge";
import type { WorkflowEdgeData, WorkflowFlowEdge } from "@web/components/canvas/types";

/**
 * `WorkflowEdge` is exercised directly (mirroring `canvas-node.test.tsx`'s approach for nodes):
 * it only reads `data` and the position props React Flow would normally supply, so a
 * `ReactFlowProvider` ancestor is enough for its `BaseEdge`/`EdgeLabelRenderer` internals to run
 * without a full `<ReactFlow>` tree and the real layout measurement jsdom cannot provide.
 */
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


/** The semantic stroke is the BaseEdge path (`react-flow__edge-path`); the halo is the plain
 * `<path>` underlay rendered before it (no edge-path/edge-interaction class). BaseEdge may also
 * emit an invisible interaction path — both are filtered out when locating the halo. */
function edgePaths(container: HTMLElement): { semantic: SVGPathElement; halo: SVGPathElement } {
  const group = container.querySelector(`[data-workflow-edge="${"e1"}"]`);
  expect(group).not.toBeNull();
  const paths = Array.from(group!.querySelectorAll("path"));
  const semantic = paths.find((p) => p.classList.contains("react-flow__edge-path"));
  const halo = paths.find((p) => p.hasAttribute("data-edge-halo"));
  expect(semantic, "semantic edge-path not rendered").toBeDefined();
  expect(halo, "halo underlay path not rendered").toBeDefined();
  return { semantic: semantic!, halo: halo! };
}

/** Every point of a path's `d`, in order (move, line, and curve control points alike). */
function pathPoints(d: string | null): Array<{ x: number; y: number }> {
  return [...(d ?? "").matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map(([, x, y]) => ({ x: Number(x), y: Number(y) }));
}

/** The 10px arrowhead drawn at every target end. */
const ARROWHEAD_LENGTH = 10;

describe("WorkflowEdge visual grammar", () => {
  describe("manual bends", () => {
    it("keeps the ordinary default path unchanged before interaction", () => {
      const result = renderInteractiveEdge(makeData());
      const expected = arrowSafeBezierPath({ x: 0, y: 0 }, Position.Right, { x: 100, y: 100 }, Position.Left)[0];

      expect(edgePaths(result.container).semantic.getAttribute("d")).toBe(expected);
      expect(result.getByRole("button", { name: "Bend edge e1" })).toBeInTheDocument();
    });

    it("ends a steep default curve on a straight run longer than the arrowhead", () => {
      // Source and target nearly aligned across the port axis: the bare bezier would only turn
      // horizontal in its last few pixels, so the line would cut through an arrowhead arm.
      const [path] = arrowSafeBezierPath({ x: 0, y: 240 }, Position.Right, { x: 20, y: 0 }, Position.Left);
      expect(path).toMatch(/ L20,0$/);
      const [beforeEnd, end] = pathPoints(path).slice(-2);
      expect(beforeEnd!.y).toBe(end!.y);
      expect(end!.x - beforeEnd!.x).toBeGreaterThan(ARROWHEAD_LENGTH);
    });

    it("draws a smooth curve through a freely dragged bend point", () => {
      const result = renderInteractiveEdge(makeData());
      const handle = result.getByRole("button", { name: "Bend edge e1" });

      fireEvent.pointerDown(handle, { pointerId: 1, clientX: 50, clientY: 50 });
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 40, clientY: 55 });
      fireEvent.pointerUp(handle, { pointerId: 1 });

      const path = edgePaths(result.container).semantic.getAttribute("d");
      expect(path).toContain(" 40,55 C");
      expect(path).toMatch(/^M0,0 /);
      expect(path).toMatch(/L100,100$/);
      expect(handle).toHaveAttribute("data-snapped", "false");
    });

    it("restores a saved bend and reports later bend changes", () => {
      const onBendChange = vi.fn();
      const result = renderInteractiveEdge(makeData({
        savedBend: { point: { x: 40, y: 55 }, snap: null },
        onBendChange,
      }));
      const handle = result.getByRole("button", { name: "Bend edge e1" });

      expect(edgePaths(result.container).semantic.getAttribute("d")).toContain(" 40,55 C");

      fireEvent.pointerDown(handle, { pointerId: 1 });
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 45, clientY: 60 });
      expect(onBendChange).not.toHaveBeenCalled();
      fireEvent.pointerUp(handle, { pointerId: 1 });

      expect(onBendChange).toHaveBeenLastCalledWith({ point: { x: 45, y: 60 }, snap: null });
    });

    it("snaps to an orthogonal route that follows both endpoint directions", () => {
      // The vertical run sits on the side of the edge that the pointer was dragged towards.
      const cases = [
        { pointer: { clientX: 20, clientY: 80 }, verticalNearSource: true },
        { pointer: { clientX: 80, clientY: 20 }, verticalNearSource: false },
      ];

      for (const { pointer, verticalNearSource } of cases) {
        const result = renderInteractiveEdge(makeData());
        const handle = result.getByRole("button", { name: "Bend edge e1" });
        fireEvent.pointerDown(handle, { pointerId: 1 });
        fireEvent.pointerMove(handle, { pointerId: 1, ...pointer });
        fireEvent.pointerUp(handle, { pointerId: 1 });

        const d = edgePaths(result.container).semantic.getAttribute("d");
        expect(d).toMatch(/^M[\d.,-]+( L[\d.,-]+)+$/);
        const points = pathPoints(d);
        expect(points[0]).toEqual({ x: 0, y: 0 });
        expect(points.at(-1)).toEqual({ x: 100, y: 100 });
        const segments = points.slice(1).map((point, index) => ({ from: points[index]!, to: point }));
        for (const { from, to } of segments) {
          expect(from.x === to.x || from.y === to.y, `${from.x},${from.y} -> ${to.x},${to.y}`).toBe(true);
        }
        // Both ends leave and enter horizontally, along their Right/Left ports.
        expect(segments[0]!.from.y).toBe(segments[0]!.to.y);
        expect(segments.at(-1)!.from.y).toBe(segments.at(-1)!.to.y);
        const vertical = segments.find(({ from, to }) => from.x === to.x && from.y !== to.y)!;
        expect(vertical.from.x < 50).toBe(verticalNearSource);
        expect(handle).toHaveAttribute("data-snapped", "true");
        result.unmount();
      }
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

      expect(edgePaths(result.container).semantic.getAttribute("d")).toBe(
        arrowSafeBezierPath({ x: 0, y: 0 }, Position.Right, { x: 100, y: 100 }, Position.Left)[0],
      );
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
});
