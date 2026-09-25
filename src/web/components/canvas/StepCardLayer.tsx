import { useLayoutEffect, useMemo, type RefObject } from "react";
import { useReactFlow, ViewportPortal } from "@xyflow/react";
import type { Workflow } from "@schema/workflow";
import type { SourceStatus } from "../../api/types";
import { useCodeHQStore } from "../../store/useCodeHQStore";
import type { FitInsets } from "./fitViewport";
import { computeOutcomeStepIds } from "./graph";
import type { LayoutBounds } from "./layout";
import { StepCard, STEP_CARD_WIDTH } from "./StepCard";
import type { CanvasFlowNode } from "./types";

/** The card never opens smaller than this, so it is always readable, nor larger than this. */
const CARD_MIN_ZOOM = 0.9;
const CARD_MAX_ZOOM = 1.1;
/** Breathing room between the card and the chrome it is fitted between. */
const CARD_MARGIN = 8;

export interface StepCardLayerProps {
  workflow: Workflow;
  sourceChecks: Record<string, SourceStatus>;
  nodes: CanvasFlowNode[];
  bounds: LayoutBounds;
  /** Screen edges covered by the island shell; the opened card is panned clear of them. */
  insets: FitInsets;
  containerRef: RefObject<HTMLDivElement | null>;
  reducedMotion: boolean;
}

/**
 * Opens the selected step as a `StepCard` over its own node. The card grows toward free space
 * (leftward when the node is at the board's right edge), and the viewport pans so the whole card
 * sits between the title island and the dock. The full side panel takes over once requested.
 */
export function StepCardLayer({ workflow, sourceChecks, nodes, bounds, insets, containerRef, reducedMotion }: StepCardLayerProps) {
  const reactFlow = useReactFlow();
  const selectedStepId = useCodeHQStore((state) => state.selectedStepId);
  const stepDetailFull = useCodeHQStore((state) => state.stepDetailFull);
  const selectStep = useCodeHQStore((state) => state.selectStep);
  const openStepDetailFull = useCodeHQStore((state) => state.openStepDetailFull);

  // ← → walks the work steps in story order; terminal outcomes are endpoints, not stops.
  const walk = useMemo(() => {
    const outcomes = computeOutcomeStepIds(workflow);
    return workflow.steps.filter((step) => !outcomes.has(step.id)).map((step) => step.id);
  }, [workflow]);

  const step = workflow.steps.find((candidate) => candidate.id === selectedStepId);
  const node = nodes.find((candidate) => candidate.id === selectedStepId);
  const width = node?.measured?.width ?? node?.width ?? 0;
  const growsLeft = node !== undefined && node.position.x + STEP_CARD_WIDTH > bounds.maxX + CARD_MARGIN * 3;
  const origin = node === undefined ? null : { x: growsLeft ? node.position.x + width - STEP_CARD_WIDTH : node.position.x, y: node.position.y };

  // Pan once per opened step (not on every node drag) so the card lands clear of the chrome.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (origin === null || stepDetailFull || container === null) {
      return;
    }
    const rect = container.getBoundingClientRect();
    const zoom = Math.min(Math.max(reactFlow.getZoom(), CARD_MIN_ZOOM), CARD_MAX_ZOOM);
    const freeWidth = rect.width - insets.left - insets.right;
    void reactFlow.setViewport(
      {
        x: insets.left + freeWidth / 2 - (origin.x + STEP_CARD_WIDTH / 2) * zoom,
        y: insets.top + CARD_MARGIN - origin.y * zoom,
        zoom,
      },
      { duration: reducedMotion ? 0 : 300 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStepId, stepDetailFull]);

  if (step === undefined || origin === null || stepDetailFull) {
    return null;
  }

  const close = () => {
    const id = step.id;
    selectStep(null);
    // Hand focus back to the card that opened the step, as the side panel always did.
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-step-node="${CSS.escape(id)}"]`)?.focus());
  };
  const walkTo = (direction: -1 | 1) => {
    const next = walk[walk.indexOf(step.id) + direction];
    if (next !== undefined) {
      selectStep(next);
    }
  };

  return (
    <ViewportPortal>
      <StepCard
        workflow={workflow}
        step={step}
        stepNumber={workflow.steps.indexOf(step) + 1}
        sourceChecks={sourceChecks}
        origin={origin}
        growsLeft={growsLeft}
        onClose={close}
        onOpenFull={openStepDetailFull}
        onWalk={walkTo}
      />
    </ViewportPortal>
  );
}
