/** Converts a `LayoutResult` plus current UI state into the plain node/edge arrays React Flow
 * renders. Kept out of `WorkflowCanvas.tsx` so that component stays focused on wiring. */
import type { FocusEvent as ReactFocusEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { Position, type NodeHandle } from "@xyflow/react";
import type { Workflow } from "@schema/workflow";
import type { SourceStatus } from "../../api/types";
import { outcomeTone } from "../../design/semantics";
import { computeIncomingTypes } from "./graph";
import type { LayoutResult } from "./layout";
import { effectiveDepthForStep, stepHasMissingSource } from "./nodeContent";
import type { OutcomeFlowNode, StepFlowNode, WorkflowFlowEdge } from "./types";

export function restoreGeneratedNodePositions<
  NodeType extends { id: string; position: { x: number; y: number } },
>(nodes: NodeType[], generatedNodes: NodeType[]): NodeType[] {
  const generatedPositions = new Map(generatedNodes.map((node) => [node.id, node.position]));
  return nodes.map((node) => ({ ...node, position: generatedPositions.get(node.id) ?? node.position }));
}

function isStepExpanded(expandedStepIds: Record<string, true>, stepId: string): boolean {
  return expandedStepIds[stepId] === true;
}

/** Rendered size of the visible geometric ports in both node stylesheets. */
const HANDLE_SIZE = 10;
const RETRY_IN_FRACTION = 0.28;
const RETRY_OUT_FRACTION = 0.72;

/** The four target-side ports shared by work cards and terminal outcome pills. The default
 * "in" id is the left-facing port; the other ids name their physical side explicitly. */
function cardinalTargetHandles(width: number, height: number): NodeHandle[] {
  return [
    { id: "in", type: "target", position: Position.Left, x: -HANDLE_SIZE / 2, y: height / 2 - HANDLE_SIZE / 2, width: HANDLE_SIZE, height: HANDLE_SIZE },
    { id: "in-right", type: "target", position: Position.Right, x: width - HANDLE_SIZE / 2, y: height / 2 - HANDLE_SIZE / 2, width: HANDLE_SIZE, height: HANDLE_SIZE },
    { id: "in-top", type: "target", position: Position.Top, x: width / 2 - HANDLE_SIZE / 2, y: -HANDLE_SIZE / 2, width: HANDLE_SIZE, height: HANDLE_SIZE },
    { id: "in-bottom", type: "target", position: Position.Bottom, x: width / 2 - HANDLE_SIZE / 2, y: height - HANDLE_SIZE / 2, width: HANDLE_SIZE, height: HANDLE_SIZE },
  ];
}

/**
 * The connection anchors, stated up front instead of left to be measured.
 *
 * React Flow refuses to draw an edge until `isNodeInitialized` passes for both endpoints, and
 * that needs `internals.handleBounds`. Those bounds come from one of two places: this array,
 * parsed synchronously inside `adoptUserNodes`, or a ResizeObserver callback that measures the
 * rendered handle elements. Supplying only width/height left the DOM path as the sole source —
 * and `adoptUserNodes` throws `handleBounds` away whenever a node object's identity changes,
 * which is every server snapshot, since a fresh `workflow` rebuilds every node below. A single
 * missed measurement then wedged the board at zero edges permanently: ResizeObserver does not
 * re-fire for an unchanged size, and nothing here re-syncs nodes to trigger another pass. That
 * is what made the failure load-dependent rather than reproducible.
 *
 * Declaring the bounds removes the measurement dependency altogether, which is also what the
 * rest of this canvas already does — see `nodeContent.ts` and the node stylesheets: layout is
 * computed from content, never read back from the DOM. Edge geometry was the one place that
 * broke that rule. The values below reproduce exactly what the DOM path produced (verified
 * against live measured bounds), so anchors do not shift by a pixel; the invisible `<Handle>`
 * elements stay in the node components, and React Flow may still overwrite these from the DOM
 * whenever a measurement does land, with both sources agreeing.
 */
function stepHandles(
  width: number,
  height: number,
  failure: boolean,
  success: boolean,
  retry: boolean,
  returnIn: boolean,
  returnOut: boolean,
): NodeHandle[] {
  return [
    ...cardinalTargetHandles(width, height),
    { id: "out", type: "source", position: Position.Right, x: width - HANDLE_SIZE / 2, y: height / 2 - HANDLE_SIZE / 2, width: HANDLE_SIZE, height: HANDLE_SIZE },
    { id: "out-left", type: "source", position: Position.Left, x: -HANDLE_SIZE / 2, y: height / 2 - HANDLE_SIZE / 2, width: HANDLE_SIZE, height: HANDLE_SIZE },
    { id: "out-top", type: "source", position: Position.Top, x: width / 2 - HANDLE_SIZE / 2, y: -HANDLE_SIZE / 2, width: HANDLE_SIZE, height: HANDLE_SIZE },
    { id: "out-bottom", type: "source", position: Position.Bottom, x: width / 2 - HANDLE_SIZE / 2, y: height - HANDLE_SIZE / 2, width: HANDLE_SIZE, height: HANDLE_SIZE },
    ...(failure ? [{ id: "failure", type: "source" as const, position: Position.Top, x: width / 2 - HANDLE_SIZE / 2, y: -HANDLE_SIZE / 2, width: HANDLE_SIZE, height: HANDLE_SIZE }] : []),
    ...(success ? [{ id: "success", type: "source" as const, position: Position.Bottom, x: width / 2 - HANDLE_SIZE / 2, y: height - HANDLE_SIZE / 2, width: HANDLE_SIZE, height: HANDLE_SIZE }] : []),
    ...(returnIn ? [{ id: "return-in", type: "target" as const, position: Position.Top, x: width * 0.3 - HANDLE_SIZE / 2, y: -HANDLE_SIZE / 2, width: HANDLE_SIZE, height: HANDLE_SIZE }] : []),
    ...(returnOut ? [{ id: "return-out", type: "source" as const, position: Position.Top, x: width * 0.7 - HANDLE_SIZE / 2, y: -HANDLE_SIZE / 2, width: HANDLE_SIZE, height: HANDLE_SIZE }] : []),
    ...(retry ? [
      { id: "retry-in", type: "target" as const, position: Position.Right, x: width - HANDLE_SIZE / 2, y: height * RETRY_IN_FRACTION - HANDLE_SIZE / 2, width: HANDLE_SIZE, height: HANDLE_SIZE },
      { id: "retry-out", type: "source" as const, position: Position.Right, x: width - HANDLE_SIZE / 2, y: height * RETRY_OUT_FRACTION - HANDLE_SIZE / 2, width: HANDLE_SIZE, height: HANDLE_SIZE },
    ] : []),
  ];
}

/** Chooses the pair of facing card sides along the dominant centre-to-centre axis. Horizontal
 * wins exact diagonals so the initial left-to-right layout keeps its established anchors. */
export function chooseCardinalHandles(
  source: { x: number; y: number; width: number; height: number },
  target: { x: number; y: number; width: number; height: number },
): { sourceHandle: string; targetHandle: string } {
  const dx = target.x + target.width / 2 - (source.x + source.width / 2);
  const dy = target.y + target.height / 2 - (source.y + source.height / 2);

  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { sourceHandle: "out", targetHandle: "in" }
      : { sourceHandle: "out-left", targetHandle: "in-right" };
  }

  return dy >= 0
    ? { sourceHandle: "out-bottom", targetHandle: "in-top" }
    : { sourceHandle: "out-top", targetHandle: "in-bottom" };
}

/** Shared hover/focus wiring every node (step or outcome) needs for path tracing (contract §11:
 * "Must work for keyboard focus too, not just mouse"). */
export interface TraceHandlers {
  onHoverStart: (stepId: string) => void;
  onHoverEnd: () => void;
  onFocusStep: (stepId: string) => void;
  onBlurStep: () => void;
}

export interface BuildFlowNodesParams extends TraceHandlers {
  workflow: Workflow;
  layout: LayoutResult;
  backEdgeIds: ReadonlySet<string>;
  expandedStepIds: Record<string, true>;
  sourceChecks: Record<string, SourceStatus>;
  selectedStepId: string | null;
  /** The active trace's one-hop step set (anchor + immediate upstream/downstream), or `null` when
   * nothing is hovered/focused/selected — every node dims when this is non-null and doesn't
   * contain it. */
  traceStepIds: ReadonlySet<string> | null;
  getTabIndex: (stepId: string) => 0 | -1;
  onToggleExpand: (stepId: string) => void;
  onNodeKeyDown: (event: ReactKeyboardEvent<HTMLElement>, stepId: string) => void;
}

export function buildFlowNodes(params: BuildFlowNodesParams): Array<StepFlowNode | OutcomeFlowNode> {
  const stepById = new Map(params.workflow.steps.map((step) => [step.id, step] as const));
  const incomingTypesByStep = computeIncomingTypes(params.workflow);
  const outcomeNodeById = new Map(
    params.layout.nodes.filter((node) => node.isOutcome).map((node) => [node.id, node] as const),
  );
  const flagsByStepId = new Map<string, {
    hasFailureOutcome: boolean;
    hasSuccessOutcome: boolean;
    hasRetry: boolean;
    hasReturnIn: boolean;
    hasReturnOut: boolean;
  }>(
    params.layout.nodes.map((node) => [node.id, {
      hasFailureOutcome: false,
      hasSuccessOutcome: false,
      hasRetry: false,
      hasReturnIn: false,
      hasReturnOut: false,
    }]),
  );
  params.workflow.connections.forEach((edge, index) => {
    const sourceFlags = flagsByStepId.get(edge.from);
    const targetFlags = flagsByStepId.get(edge.to);
    const outcomeBand = outcomeNodeById.get(edge.to)?.outcomeBand;
    if (sourceFlags !== undefined && outcomeBand === "failure") {
      sourceFlags.hasFailureOutcome = true;
    }
    if (sourceFlags !== undefined && outcomeBand === "success") {
      sourceFlags.hasSuccessOutcome = true;
    }
    if (sourceFlags !== undefined && edge.from === edge.to) {
      sourceFlags.hasRetry = true;
    }
    const id = edge.id ?? `${edge.from}->${edge.to}#${index}`;
    if (edge.from !== edge.to && params.backEdgeIds.has(id)) {
      if (sourceFlags !== undefined) {
        sourceFlags.hasReturnOut = true;
      }
      if (targetFlags !== undefined) {
        targetFlags.hasReturnIn = true;
      }
    }
  });

  return params.layout.nodes.map((layoutNode): StepFlowNode | OutcomeFlowNode => {
    const step = stepById.get(layoutNode.id);
    if (step === undefined) {
      // computeLayout only ever produces one LayoutNode per workflow.steps entry, so this
      // would mean layout and workflow have desynchronized — a programming error, not
      // something a malformed workflow file could trigger (schema validation already ran).
      throw new Error(`Layout produced a node for unknown step '${layoutNode.id}'.`);
    }

    const dimmed = params.traceStepIds !== null && !params.traceStepIds.has(step.id);
    const traceHandlers = {
      onHoverStart: () => params.onHoverStart(step.id),
      onHoverEnd: params.onHoverEnd,
      onFocusStep: (_event: ReactFocusEvent<HTMLElement>) => params.onFocusStep(step.id),
      onBlurStep: (_event: ReactFocusEvent<HTMLElement>) => params.onBlurStep(),
    };

    if (layoutNode.isOutcome) {
      const tone = outcomeTone(incomingTypesByStep.get(step.id) ?? []);
      const band = layoutNode.outcomeBand ?? "success";
      const semanticTargetPosition = band === "failure" ? Position.Bottom : Position.Top;
      return {
        id: layoutNode.id,
        type: "outcome",
        position: { x: layoutNode.x, y: layoutNode.y },
        width: layoutNode.width,
        height: layoutNode.height,
        handles: [
          ...cardinalTargetHandles(layoutNode.width, layoutNode.height),
          {
            id: "outcome-in",
            type: "target",
            position: semanticTargetPosition,
            x: layoutNode.width / 2 - HANDLE_SIZE / 2,
            y: semanticTargetPosition === Position.Top ? -HANDLE_SIZE / 2 : layoutNode.height - HANDLE_SIZE / 2,
            width: HANDLE_SIZE,
            height: HANDLE_SIZE,
          },
        ],
        targetPosition: Position.Left,
        data: {
          step,
          tone,
          band,
          dimmed,
          tabIndex: params.getTabIndex(step.id),
          onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => params.onNodeKeyDown(event, step.id),
          ...traceHandlers,
        },
      };
    }

    const flags = flagsByStepId.get(step.id)!;
    const { hasFailureOutcome, hasSuccessOutcome, hasRetry, hasReturnIn, hasReturnOut } = flags;
    return {
      id: layoutNode.id,
      type: "step",
      position: { x: layoutNode.x, y: layoutNode.y },
      width: layoutNode.width,
      height: layoutNode.height,
      handles: stepHandles(
        layoutNode.width,
        layoutNode.height,
        hasFailureOutcome,
        hasSuccessOutcome,
        hasRetry,
        hasReturnIn,
        hasReturnOut,
      ),
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        step,
        index: layoutNode.index,
        effectiveDepth: effectiveDepthForStep(step, params.expandedStepIds),
        expanded: isStepExpanded(params.expandedStepIds, step.id),
        selected: step.id === params.selectedStepId,
        hasMissingSource: stepHasMissingSource(step, params.sourceChecks),
        hasFailureOutcome,
        hasSuccessOutcome,
        hasRetry,
        hasReturnIn,
        hasReturnOut,
        dimmed,
        tabIndex: params.getTabIndex(step.id),
        onToggleExpand: () => params.onToggleExpand(step.id),
        onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => params.onNodeKeyDown(event, step.id),
        ...traceHandlers,
      },
    };
  });
}
export function buildFlowEdges(
  layout: LayoutResult,
  backEdgeIds: ReadonlySet<string>,
  traceEdgeIds: ReadonlySet<string> | null,
): WorkflowFlowEdge[] {
  const nodeById = new Map(layout.nodes.map((node) => [node.id, node] as const));

  return layout.edges.map((edge) => {
    // Only a literal self-loop means retry. Other DFS back edges retain their declared semantics.
    const isRetryLoop = backEdgeIds.has(edge.id) && edge.source === edge.target;
    const isReturnEdge = backEdgeIds.has(edge.id) && edge.source !== edge.target;
    const targetNode = nodeById.get(edge.target);
    const sourceNode = nodeById.get(edge.source);
    const cardinalHandles = !isRetryLoop && !isReturnEdge && targetNode?.isOutcome !== true && sourceNode !== undefined && targetNode !== undefined
      ? chooseCardinalHandles(sourceNode, targetNode)
      : undefined;
    // `computeTracePath` supplies only the anchor's outgoing edge ids. All other edges remain in
    // the canvas as context but dim while a trace is active.
    const dimmed = traceEdgeIds !== null && !traceEdgeIds.has(edge.id);
    const traced = traceEdgeIds !== null && !dimmed;
    const outcomeBand = targetNode?.isOutcome === true
      ? targetNode.outcomeBand ?? "success"
      : undefined;

    const sourceHandle = isRetryLoop
      ? "retry-out"
      : isReturnEdge
        ? "return-out"
        : cardinalHandles?.sourceHandle ?? (targetNode?.isOutcome
          ? targetNode.outcomeBand === "failure" ? "failure" : "success"
          : "out");
    const targetHandle = isRetryLoop
      ? "retry-in"
      : isReturnEdge
        ? "return-in"
        : cardinalHandles?.targetHandle ?? (targetNode?.isOutcome === true ? "outcome-in" : "in");

    return {
      id: edge.id,
      type: "workflow",
      source: edge.source,
      target: edge.target,
      sourceHandle,
      targetHandle,
      focusable: false,
      data: {
        connection: edge.connection,
        retry: isRetryLoop,
        returnEdge: isReturnEdge,
        branch: targetNode?.isOutcome === true,
        ...(outcomeBand !== undefined ? { outcomeBand } : {}),
        dimmed,
        traced,
      },
    };
  });
}
