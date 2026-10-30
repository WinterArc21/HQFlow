import { useLayoutEffect, useState, type RefObject } from "react";
import { useReactFlow, ViewportPortal } from "@xyflow/react";
import type { Workflow } from "@schema/workflow";
import type { SourceStatus } from "../../api/types";
import { useCodeHQStore } from "../../store/useCodeHQStore";
import type { FitInsets } from "./fitViewport";
import type { LayoutBounds } from "./layout";
import { StepCard, STEP_CARD_HEIGHT, STEP_CARD_WIDTH } from "./StepCard";
import type { CanvasFlowNode } from "./types";

/** The card never opens smaller than this, so it is always readable, nor larger than this. */
const CARD_MIN_ZOOM = 0.9;
const CARD_MAX_ZOOM = 1.1;
/** On a small screen the card shrinks to fit between the chrome, down to this floor. */
const CARD_FLOOR_ZOOM = 0.5;
/** Breathing room between the card and the chrome it is fitted between. */
const CARD_MARGIN = 8;
/** How long the camera takes to bring an opened card into view. */
const CAMERA_MS = 300;

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
 * sits between the title island and the dock.
 */
export function StepCardLayer({ workflow, sourceChecks, nodes, bounds, insets, containerRef, reducedMotion }: StepCardLayerProps) {
  const reactFlow = useReactFlow();
  const selectedStepId = useCodeHQStore((state) => state.selectedStepId);
  const selectStep = useCodeHQStore((state) => state.selectStep);

  const step = workflow.steps.find((candidate) => candidate.id === selectedStepId);
  const node = nodes.find((candidate) => candidate.id === selectedStepId);
  const width = node?.measured?.width ?? node?.width ?? 0;
  const growsLeft = node !== undefined && node.position.x + STEP_CARD_WIDTH > bounds.maxX + CARD_MARGIN * 3;
  const origin = node === undefined ? null : { x: growsLeft ? node.position.x + width - STEP_CARD_WIDTH : node.position.x, y: node.position.y };

  // A newly opened card waits for the camera to settle. The first open usually zooms in, and a
  // zoom redraws the whole board on every frame, so an iris played during it stuttered and was
  // hard to see. Selecting another step keeps the open card, so it moves with the camera.
  const [revealed, setRevealed] = useState(false);
  if (revealed && selectedStepId === null) {
    setRevealed(false);
  }

  // Pan once per opened step (not on every node drag) so the card lands clear of the chrome.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (origin === null || container === null) {
      return;
    }
    const rect = container.getBoundingClientRect();
    const freeWidth = rect.width - insets.left - insets.right;
    const freeHeight = rect.height - insets.top - insets.bottom;
    const fitsZoom = Math.min((freeWidth - CARD_MARGIN * 2) / STEP_CARD_WIDTH, (freeHeight - CARD_MARGIN * 2) / STEP_CARD_HEIGHT);
    const minZoom = Math.max(CARD_FLOOR_ZOOM, Math.min(CARD_MIN_ZOOM, fitsZoom));
    const zoom = Math.min(Math.max(reactFlow.getZoom(), minZoom), CARD_MAX_ZOOM, Math.max(fitsZoom, minZoom));
    const duration = reducedMotion ? 0 : CAMERA_MS;
    const moved = reactFlow.setViewport(
      {
        x: insets.left + freeWidth / 2 - (origin.x + STEP_CARD_WIDTH / 2) * zoom,
        y: insets.top + CARD_MARGIN - origin.y * zoom,
        zoom,
      },
      { duration },
    );
    if (revealed || duration === 0) {
      return;
    }
    // React Flow settles the promise only when the move ends, not when a pan interrupts it.
    let cancelled = false;
    void Promise.race([moved, new Promise((resolve) => setTimeout(resolve, duration + 50))]).then(() => {
      if (!cancelled) setRevealed(true);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStepId]);

  if (step === undefined || origin === null || !(revealed || reducedMotion)) {
    return null;
  }

  const close = () => {
    const id = step.id;
    selectStep(null);
    // Hand focus back to the card that opened the step, as the side panel always did.
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-step-node="${CSS.escape(id)}"]`)?.focus());
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
      />
    </ViewportPortal>
  );
}
