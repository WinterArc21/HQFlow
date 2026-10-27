/** Converts a `LayoutResult` plus current UI state into the plain node/edge arrays React Flow
 * renders. Kept out of `WorkflowCanvas.tsx` so that component stays focused on wiring. */
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { Position, type NodeHandle } from "@xyflow/react";
import type { Workflow } from "@schema/workflow";
import type { SourceStatus } from "../../api/types";
import { outcomeTone } from "../../design/semantics";
import { computeIncomingTypes } from "./graph";
import { WRAP_ROW_GAP, type CanvasView, type LayoutResult, type OutcomeBand } from "./layout";
import { stepHasMissingSource } from "./nodeContent";
import type { OutcomeFlowNode, StepFlowNode, WorkflowFlowEdge } from "./types";
import type { CanvasBend } from "../../store/useCodeHQStore";

export function restoreGeneratedNodePositions<
  NodeType extends { id: string; position: { x: number; y: number } },
>(nodes: NodeType[], generatedNodes: NodeType[]): NodeType[] {
  const generatedPositions = new Map(generatedNodes.map((node) => [node.id, node.position]));
  return nodes.map((node) => ({ ...node, position: generatedPositions.get(node.id) ?? node.position }));
}

/** Rendered size of the invisible target-side anchors in both node stylesheets (`.handleHidden`
 * in StepNode, `.handle` in OutcomeNode). */
const HANDLE_SIZE = 10;
/** Rendered size of the visible source-side port squares (`.handle` in StepNode). */
const SOURCE_HANDLE_SIZE = 7;
export const RETRY_IN_FRACTION = 0.28;
export const RETRY_OUT_FRACTION = 0.72;

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
    { id: "out", type: "source", position: Position.Right, x: width - SOURCE_HANDLE_SIZE / 2, y: height / 2 - SOURCE_HANDLE_SIZE / 2, width: SOURCE_HANDLE_SIZE, height: SOURCE_HANDLE_SIZE },
    { id: "out-left", type: "source", position: Position.Left, x: -SOURCE_HANDLE_SIZE / 2, y: height / 2 - SOURCE_HANDLE_SIZE / 2, width: SOURCE_HANDLE_SIZE, height: SOURCE_HANDLE_SIZE },
    { id: "out-top", type: "source", position: Position.Top, x: width / 2 - SOURCE_HANDLE_SIZE / 2, y: -SOURCE_HANDLE_SIZE / 2, width: SOURCE_HANDLE_SIZE, height: SOURCE_HANDLE_SIZE },
    { id: "out-bottom", type: "source", position: Position.Bottom, x: width / 2 - SOURCE_HANDLE_SIZE / 2, y: height - SOURCE_HANDLE_SIZE / 2, width: SOURCE_HANDLE_SIZE, height: SOURCE_HANDLE_SIZE },
    ...(failure ? [{ id: "failure", type: "source" as const, position: Position.Top, x: width / 2 - SOURCE_HANDLE_SIZE / 2, y: -SOURCE_HANDLE_SIZE / 2, width: SOURCE_HANDLE_SIZE, height: SOURCE_HANDLE_SIZE }] : []),
    ...(success ? [{ id: "success", type: "source" as const, position: Position.Bottom, x: width / 2 - SOURCE_HANDLE_SIZE / 2, y: height - SOURCE_HANDLE_SIZE / 2, width: SOURCE_HANDLE_SIZE, height: SOURCE_HANDLE_SIZE }] : []),
    ...(returnIn ? [{ id: "return-in", type: "target" as const, position: Position.Top, x: width * 0.3 - HANDLE_SIZE / 2, y: -HANDLE_SIZE / 2, width: HANDLE_SIZE, height: HANDLE_SIZE }] : []),
    ...(returnOut ? [{ id: "return-out", type: "source" as const, position: Position.Top, x: width * 0.7 - SOURCE_HANDLE_SIZE / 2, y: -SOURCE_HANDLE_SIZE / 2, width: SOURCE_HANDLE_SIZE, height: SOURCE_HANDLE_SIZE }] : []),
    ...(retry ? [
      { id: "retry-in", type: "target" as const, position: Position.Right, x: width - HANDLE_SIZE / 2, y: height * RETRY_IN_FRACTION - HANDLE_SIZE / 2, width: HANDLE_SIZE, height: HANDLE_SIZE },
      { id: "retry-out", type: "source" as const, position: Position.Right, x: width - SOURCE_HANDLE_SIZE / 2, y: height * RETRY_OUT_FRACTION - SOURCE_HANDLE_SIZE / 2, width: SOURCE_HANDLE_SIZE, height: SOURCE_HANDLE_SIZE },
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

type Box = { x: number; y: number; width: number; height: number };

/** Line view: whether an outcome sits in its band past its step (above for failure, below for
 * success) and so uses the step's band port. An outcome hung under its step does not. */
function inBandBeyond(source: Box, target: Box, band: OutcomeBand | undefined): boolean {
  return band === "failure" ? target.y + target.height <= source.y : band === "success" && target.y >= source.y + source.height;
}

/**
 * The handle pair for a connection in a given view. Flow prefers a straight drop from the bottom
 * of one card into the top of the next; the other views use the facing sides.
 */
export function chooseViewHandles(
  view: CanvasView,
  source: Box,
  target: Box,
  targetIsOutcome = false,
): { sourceHandle: string; targetHandle: string } {
  if (view === "flow") {
    // An outcome stack hangs beside its step: leave from the facing side, even for a lower pill.
    if (targetIsOutcome && target.x >= source.x + source.width) {
      return { sourceHandle: "out", targetHandle: "in" };
    }
    if (targetIsOutcome && target.x + target.width <= source.x) {
      return { sourceHandle: "out-left", targetHandle: "in-right" };
    }
    if (target.y >= source.y + source.height) {
      return { sourceHandle: "out-bottom", targetHandle: "in-top" };
    }
  }
  // Line reads left to right: a card in another column connects side to side, however far down
  // it sits, so the line never drops through the cards stacked between them.
  if (view === "line" && !targetIsOutcome && target.x !== source.x) {
    return target.x > source.x ? { sourceHandle: "out", targetHandle: "in" } : { sourceHandle: "out-left", targetHandle: "in-right" };
  }
  return chooseCardinalHandles(source, target);
}

/** Shared hover wiring every node (step or outcome) needs for path tracing. */
export interface TraceHandlers {
  onHoverStart: (stepId: string) => void;
  onHoverEnd: () => void;
}

export interface BuildFlowNodesParams extends TraceHandlers {
  workflow: Workflow;
  layout: LayoutResult;
  backEdgeIds: ReadonlySet<string>;
  sourceChecks: Record<string, SourceStatus>;
  selectedStepId: string | null;
  /** The active trace's one-hop step set (anchor + immediate upstream/downstream), or `null` when
   * nothing is hovered/focused/selected — every node dims when this is non-null and doesn't
   * contain it. */
  traceStepIds: ReadonlySet<string> | null;
  getTabIndex: (stepId: string) => 0 | -1;
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
    // Outside the line view, outcome and return edges use the ordinary side ports.
    const lineView = params.layout.view === "line";
    const outcomeNode = lineView ? outcomeNodeById.get(edge.to) : undefined;
    const sourceNode = params.layout.nodes.find((node) => node.id === edge.from);
    const outcomeBand = outcomeNode !== undefined && sourceNode !== undefined && inBandBeyond(sourceNode, outcomeNode, outcomeNode.outcomeBand)
      ? outcomeNode.outcomeBand
      : undefined;
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
    if (lineView && edge.from !== edge.to && params.backEdgeIds.has(id)) {
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
        selected: step.id === params.selectedStepId,
        hasMissingSource: stepHasMissingSource(step, params.sourceChecks),
        hasFailureOutcome,
        hasSuccessOutcome,
        hasRetry,
        hasReturnIn,
        hasReturnOut,
        dimmed,
        tabIndex: params.getTabIndex(step.id),
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
  bendResetKey?: string,
  savedBends: Record<string, CanvasBend> = {},
  onBendChange?: (edgeId: string, bend: CanvasBend) => void,
): WorkflowFlowEdge[] {
  const nodeById = new Map(layout.nodes.map((node) => [node.id, node] as const));
  const siblingsByPair = new Map<string, string[]>();
  for (const edge of layout.edges) {
    if (edge.source === edge.target) {
      continue;
    }
    const key = `${edge.source}\u0000${edge.target}`;
    siblingsByPair.set(key, [...(siblingsByPair.get(key) ?? []), edge.id]);
  }
  const parallelOffsetOf = (edge: LayoutResult["edges"][number]): number => {
    const siblings = siblingsByPair.get(`${edge.source}\u0000${edge.target}`);
    if (siblings === undefined || siblings.length < 2) {
      return 0;
    }
    return siblings.indexOf(edge.id) - (siblings.length - 1) / 2;
  };

  return layout.edges.map((edge) => {
    // Only a literal self-loop means retry. Other DFS back edges retain their declared semantics.
    const isRetryLoop = backEdgeIds.has(edge.id) && edge.source === edge.target;
    const isReturnEdge = backEdgeIds.has(edge.id) && edge.source !== edge.target;
    const parallelOffset = parallelOffsetOf(edge);
    const targetNode = nodeById.get(edge.target);
    const sourceNode = nodeById.get(edge.source);
    const lineView = layout.view === "line";
    // A wrap edge into a later row returns under its row to the start of the next one.
    const turnY = layout.view === "wrap" && !isReturnEdge && !isRetryLoop && targetNode?.isOutcome !== true
      && sourceNode?.row !== undefined && targetNode?.row !== undefined && targetNode.row > sourceNode.row
      ? (layout.wrapRowBottoms?.[sourceNode.row] ?? 0) + WRAP_ROW_GAP / 2
      : undefined;
    // Outside the line view a return edge runs up the right side of the whole map.
    const sideReturnX = !lineView && isReturnEdge ? layout.bounds.maxX + 56 : undefined;
    const cardinalHandles = turnY !== undefined || sideReturnX !== undefined
      ? { sourceHandle: "out", targetHandle: turnY !== undefined ? "in" : "in-right" }
      : !isRetryLoop && !isReturnEdge && sourceNode !== undefined && targetNode !== undefined
        && (targetNode.isOutcome !== true || !lineView || !inBandBeyond(sourceNode, targetNode, targetNode.outcomeBand))
        ? chooseViewHandles(layout.view, sourceNode, targetNode, targetNode.isOutcome)
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
      : cardinalHandles?.sourceHandle ?? (isReturnEdge
        ? "return-out"
        : targetNode?.isOutcome
          ? targetNode.outcomeBand === "failure" ? "failure" : "success"
          : "out");
    const targetHandle = isRetryLoop
      ? "retry-in"
      : cardinalHandles?.targetHandle ?? (isReturnEdge
        ? "return-in"
        : targetNode?.isOutcome === true ? "outcome-in" : "in");

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
        ...(parallelOffset !== 0 ? { parallelOffset } : {}),
        ...(outcomeBand !== undefined ? { outcomeBand } : {}),
        ...(!lineView && !isRetryLoop ? { routing: "step" as const } : {}),
        ...(turnY !== undefined ? { turnY } : {}),
        ...(sideReturnX !== undefined ? { returnX: sideReturnX } : {}),
        dimmed,
        traced,
        ...(bendResetKey !== undefined ? { bendResetKey } : {}),
        ...(savedBends[edge.id] !== undefined ? { savedBend: savedBends[edge.id] } : {}),
        ...(onBendChange !== undefined ? { onBendChange: (bend: CanvasBend) => onBendChange(edge.id, bend) } : {}),
      },
    };
  });
}
