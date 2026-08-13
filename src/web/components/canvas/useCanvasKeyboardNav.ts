/**
 * Roving-tabindex keyboard navigation over the canvas's real `StepNode` elements (contract §11).
 * Exactly one node is ever part of the natural Tab order (`tabIndex === 0`); arrow keys move
 * both the roving target and actual DOM focus synchronously inside the keydown handler, and pan
 * the viewport so the newly-focused node stays visible — deliberately not a `useEffect`, so
 * focus never moves on its own outside a direct key press.
 */
import { useCallback, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import type { ReactFlowInstance } from "@xyflow/react";
import type { Workflow } from "@schema/workflow";
import { computeArrowNavigation, computeTopologicalOrder } from "./graph";
import type { LayoutNode } from "./layout";

export interface UseCanvasKeyboardNavParams {
  workflow: Workflow;
  layoutNodes: LayoutNode[];
  containerRef: RefObject<HTMLDivElement | null>;
  reactFlowInstance: Pick<ReactFlowInstance, "setCenter" | "getZoom">;
  selectedStepId: string | null;
  onSelect: (stepId: string) => void;
  onClear: () => void;
  reducedMotion: boolean;
  /** Newly added cards stay in the graph for measurement but stay out of keyboard order. */
  hiddenStepIds?: ReadonlySet<string>;
}

export interface UseCanvasKeyboardNavResult {
  /** `0` for the single node currently in the natural Tab order, `-1` for every other node. */
  getTabIndex: (stepId: string) => 0 | -1;
  handleNodeKeyDown: (event: ReactKeyboardEvent<HTMLElement>, stepId: string) => void;
  /** Called on pointer interaction so Tab-ing away and back resumes at the last-used node. */
  setRovingId: (stepId: string) => void;
  /** Pans a node into the visible canvas, optionally accounting for a right-side overlay. */
  panToNode: (stepId: string, rightOverlayWidth?: number) => void;
}

const ACTIVATION_KEYS = new Set(["Enter", " "]);

export function useCanvasKeyboardNav(params: UseCanvasKeyboardNavParams): UseCanvasKeyboardNavResult {
  const { workflow, layoutNodes, containerRef, reactFlowInstance, selectedStepId, onSelect, onClear, reducedMotion, hiddenStepIds } = params;
  const [rovingId, setRovingId] = useState<string | null>(null);

  const effectiveRovingId = rovingId ?? selectedStepId ?? workflow.steps[0]?.id ?? null;

  const getTabIndex = useCallback(
    (stepId: string): 0 | -1 => (hiddenStepIds?.has(stepId) === true || stepId !== effectiveRovingId ? -1 : 0),
    [effectiveRovingId, hiddenStepIds],
  );

  const panToNode = useCallback(
    (stepId: string, rightOverlayWidth = 0): void => {
      const node = layoutNodes.find((candidate) => candidate.id === stepId);
      if (node === undefined) {
        return;
      }
      const zoom = reactFlowInstance.getZoom();
      void reactFlowInstance.setCenter(
        node.x + node.width / 2 + rightOverlayWidth / (2 * zoom),
        node.y + node.height / 2,
        {
          zoom,
          duration: reducedMotion ? 0 : 300,
        },
      );
    },
    [layoutNodes, reactFlowInstance, reducedMotion],
  );

  const focusAndCenter = useCallback(
    (stepId: string): void => {
      setRovingId(stepId);

      const elements = containerRef.current?.querySelectorAll<HTMLElement>("[data-step-node]") ?? [];
      for (const element of Array.from(elements)) {
        if (element.dataset.stepNode === stepId) {
          element.focus();
          break;
        }
      }

      panToNode(stepId);
    },
    [containerRef, panToNode],
  );

  const handleNodeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>, stepId: string): void => {
      if (event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const direction = event.key.slice("Arrow".length).toLowerCase() as "up" | "down" | "left" | "right";
        const next = computeArrowNavigation(workflow, stepId)[direction];
        if (next !== undefined && hiddenStepIds?.has(next) !== true) {
          focusAndCenter(next);
        }
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        const first = computeTopologicalOrder(workflow)[0];
        if (first !== undefined) {
          focusAndCenter(first);
        }
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        const order = computeTopologicalOrder(workflow);
        const last = order[order.length - 1];
        if (last !== undefined) {
          focusAndCenter(last);
        }
        return;
      }
      if (ACTIVATION_KEYS.has(event.key)) {
        event.preventDefault();
        onSelect(stepId);
        return;
      }
      if (event.key === "Escape") {
        onClear();
      }
    },
    [workflow, focusAndCenter, hiddenStepIds, onSelect, onClear],
  );

  return { getTabIndex, handleNodeKeyDown, setRovingId, panToNode };
}
