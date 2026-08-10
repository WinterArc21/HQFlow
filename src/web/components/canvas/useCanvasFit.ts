/**
 * Owns the canvas's viewport-fitting behaviour — split out of `WorkflowCanvas.tsx` (contract §12:
 * "no React component file over ~200 lines") along the seam that was already documented there as
 * a distinct concern from node/edge wiring: computing the graph's bounding box, deciding the
 * fitted zoom/position via `fitViewport.ts`, and the two effects that apply it (a synchronous
 * re-fit on workflow/depth change, and a one-shot fallback for the container's very first real
 * layout).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { ReactFlowInstance } from "@xyflow/react";
import type { Depth } from "../../store/useCodeHQStore";
import { computeFitViewport, computeViewportOverflow, type Viewport } from "./fitViewport";
import type { LayoutNode } from "./layout";

/** Small margin around the fitted graph — kept tight deliberately: a generous margin here is
 * exactly what produced the old "80% empty canvas" failure. */
const FIT_VIEW_PADDING = 0.06;
/** `fitView`'s computed zoom is clamped to this floor so a large workflow anchors at a legible
 * scale and relies on panning instead of shrinking into illegibility (contract §1: "clamp the
 * minimum default zoom to something legible"). */
const FIT_VIEW_MIN_ZOOM = 0.78;
/** A small workflow should not zoom in past "designed", pixel-doubled scale. */
const FIT_VIEW_MAX_ZOOM = 1.1;
export interface UseCanvasFitParams {
  layoutNodes: LayoutNode[];
  workflowId: string;
  /** Stable serialization of the valid workflow content. Changes when a live semantic edit can
   * alter graph bounds, but not for source-check-only snapshots or local expansion state. */
  workflowRevision: string;
  depth: Depth;
  reactFlowInstance: Pick<ReactFlowInstance, "setViewport">;
  reducedMotion: boolean;
}

export interface UseCanvasFitResult {
  containerRef: RefObject<HTMLDivElement | null>;
  overflowsRight: boolean;
  overflowsBottom: boolean;
  fitToViewport: (duration: number) => void;
  updateOverflow: (viewport: Pick<Viewport, "x" | "y" | "zoom">) => void;
}

function computeGraphBounds(nodes: LayoutNode[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (nodes.length === 0) {
    return null;
  }
  return {
    minX: Math.min(...nodes.map((node) => node.x)),
    minY: Math.min(...nodes.map((node) => node.y)),
    maxX: Math.max(...nodes.map((node) => node.x + node.width)),
    maxY: Math.max(...nodes.map((node) => node.y + node.height)),
  };
}

export function useCanvasFit(params: UseCanvasFitParams): UseCanvasFitResult {
  const { layoutNodes, workflowId, workflowRevision, depth, reactFlowInstance, reducedMotion } = params;
  const containerRef = useRef<HTMLDivElement>(null);
  // Whether the fitted graph still has more content below the visible stage — a deeper depth
  // (`modules`/`symbols` grow every node) or a large workflow can be taller than even the
  // minimum legible zoom allows. Drives the "more below" affordance so a reader never mistakes a
  // cut-off last card for the end of the workflow.
  const [overflowsBottom, setOverflowsBottom] = useState(false);
  const [overflowsRight, setOverflowsRight] = useState(false);

  const updateOverflow = useCallback(
    (viewport: Pick<Viewport, "x" | "y" | "zoom">) => {
      const container = containerRef.current;
      const bounds = computeGraphBounds(layoutNodes);
      if (container === null || bounds === null) {
        return;
      }
      const rect = container.getBoundingClientRect();
      const overflow = computeViewportOverflow({
        containerWidth: rect.width,
        containerHeight: rect.height,
        bounds,
        viewport,
      });
      setOverflowsRight(overflow.overflowsRight);
      setOverflowsBottom(overflow.overflowsBottom);
    },
    [layoutNodes],
  );

  const fitToViewport = useCallback(
    (duration: number) => {
      const container = containerRef.current;
      const bounds = computeGraphBounds(layoutNodes);
      if (container === null || bounds === null) {
        return;
      }
      const rect = container.getBoundingClientRect();
      const viewport = computeFitViewport({
        containerWidth: rect.width,
        containerHeight: rect.height,
        bounds,
        minZoom: FIT_VIEW_MIN_ZOOM,
        maxZoom: FIT_VIEW_MAX_ZOOM,
        paddingRatio: FIT_VIEW_PADDING,
      });
      if (viewport !== null) {
        void reactFlowInstance.setViewport(viewport, { duration });
        setOverflowsRight(viewport.overflowsRight);
        setOverflowsBottom(viewport.overflowsBottom);
      }
    },
    [layoutNodes, reactFlowInstance],
  );

  // `useLayoutEffect`, not `useEffect`: the fit must be computed and applied before the browser
  // paints, or the very first frame flashes React Flow's own default viewport (top-left, zoom 1)
  // before snapping to the fitted one.
  useLayoutEffect(() => {
    fitToViewport(reducedMotion ? 0 : 400);
    // Re-fit on a new workflow, a valid live workflow-content update, or a global depth change
    // (contract §11). Expanding a single step, selecting a step, or a source-check-only update
    // must never re-frame the viewport.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowId, workflowRevision, depth]);

  // One-shot fallback for the very first mount: the app auto-selects the default workflow from
  // a *regular* `useEffect` in `App.tsx` (necessarily async — it reacts to the server snapshot
  // arriving), so this component's first commit can land before the flex-column chain above it
  // has settled into its final size. If that happens, `fitToViewport` above computed against a
  // zero-size container and silently did nothing, leaving React Flow's raw default viewport on
  // screen. Watch for the container's first real size and fit exactly once when it appears; it
  // then disconnects, so it never fights a user's manual pan/zoom on a later resize.
  useEffect(() => {
    const container = containerRef.current;
    if (container === null || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined && entry.contentRect.width > 0 && entry.contentRect.height > 0) {
        fitToViewport(0);
        observer.disconnect();
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
    // Deliberately mount-scoped: only ever needs to catch the first real layout, not every
    // resize (contract §11: the viewport must not re-frame on anything but a workflow/depth
    // change).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { containerRef, overflowsRight, overflowsBottom, fitToViewport, updateOverflow };
}
