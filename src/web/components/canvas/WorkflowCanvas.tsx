import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getNodesBounds, getViewportForBounds, MiniMap, ReactFlow, ReactFlowProvider, useNodesState, useReactFlow, type NodeMouseHandler } from "@xyflow/react";
import { toPng } from "html-to-image";
import type { ReactNode } from "react";
import type { Workflow } from "@schema/workflow";
import type { SourceStatus, WorkflowRecord } from "../../api/types";
import { usePrefersReducedMotion } from "../../lib/usePrefersReducedMotion";
import { useCodeHQStore } from "../../store/useCodeHQStore";
import { buildFlowEdges, buildFlowNodes, chooseViewHandles, restoreGeneratedNodePositions, splitSharedSides } from "./buildFlowElements";
import { CanvasLegend, legendRows } from "./CanvasLegend";
import { CanvasDockControls } from "./CanvasDockControls";
import { CanvasHeader, CanvasTitle } from "./CanvasHeader";
import { CanvasOverflowIndicator } from "./CanvasOverflowIndicator";
import { StepCardLayer } from "./StepCardLayer";
import { EdgeMarkers } from "./edges/EdgeMarkers";
import { WorkflowEdge } from "./edges/WorkflowEdge";
import { computeBackEdgeIds, computeTracePath } from "./graph";
import { chooseCanvasView, computeLayout, type CanvasView } from "./layout";
import { CanvasViewHint } from "./CanvasViewHint";
import { OutcomeNode } from "./nodes/OutcomeNode";
import { StepNode } from "./nodes/StepNode";
import type { CanvasFlowNode, WorkflowFlowEdge } from "./types";
import { useExportMode } from "../../export-viewer/ExportModeContext";
import { fetchWorkflowExport } from "../../api/client";
import { DeleteWorkflowDialog } from "./DeleteWorkflowDialog";
import { ExportDialog } from "./ExportDialog";
import { useCanvasLayoutPersistence } from "./useCanvasLayoutPersistence";
import { useCanvasFit } from "./useCanvasFit";
import { useCanvasKeyboardNav } from "./useCanvasKeyboardNav";
import { AgentCursor, BuildToast } from "./live/AgentCursor";
import { useLiveBuild } from "./live/useLiveBuild";
import type { FitInsets } from "./fitViewport";
import styles from "./WorkflowCanvas.module.css";

/** A minimap only earns its screen space once a graph is big enough to get lost in. Counted over
 * work-step nodes only, not outcome pills: an outcome is an endpoint a reader glances at, not
 * another unit of work to navigate, so a workflow with a handful of steps and a stack of outcome
 * pills beside them (post edge-grammar redesign, outcomes are now real nodes) should not suddenly
 * earn a minimap it didn't need when outcomes were just coloured terminal markers. Both bundled
 * test workflows (7 and 4 work steps) confirm this keeps the default 1440x900 view intrusion-
 * free while still growing in for a genuinely large workflow. */
const MINIMAP_NODE_THRESHOLD = 10;
/** The map is ~200px wide, so bounds / 100 keeps each node and the viewport frame ~2px thick. */
const MINIMAP_MIN_FEATURE_DIVISOR = 100;
/** Above this, only on-screen nodes and edges mount; image export turns it off to capture the whole graph. */
const VIRTUALIZE_NODE_THRESHOLD = 60;
const IMAGE_PADDING = 120;
/** How long cards take to glide into a newly picked view. */
const VIEW_GLIDE_MS = 600;
const MIN_IMAGE_SIZE = 800;
const MAX_IMAGE_SIZE = 4096;

const NODE_TYPES = { step: StepNode, outcome: OutcomeNode };
const EDGE_TYPES = { workflow: WorkflowEdge };

/**
 * Hands the canvas's title and controls to an outer shell instead of the built-in title strip:
 * the title renders into `titleTarget`, the controls into `controlsTarget` (both through portals,
 * so they keep this canvas's React Flow context) with the connection key in the controls' menu,
 * fitting keeps `fitInsets` clear, and cues near the bottom stay above `dockClearance`. `onCanvasMove` hears when the
 * reader starts and stops panning, zooming or dragging.
 */
export interface CanvasChrome {
  titleTarget: HTMLElement | null;
  controlsTarget: HTMLElement | null;
  dockClearance: number;
  onCanvasMove: (moving: boolean) => void;
  fitInsets: FitInsets;
}

export interface WorkflowCanvasProps {
  workflow: Workflow;
  sourceChecks: Record<string, SourceStatus>;
  /** A separate key lets another view reuse the complete canvas without impersonating a workflow API resource. */
  canvasId?: string;
  itemLabel?: string;
  exportEnabled?: boolean;
  onNodeActivate?: (nodeId: string) => void;
  /** Rendered on the dotted stage, not the title strip. */
  stageOverlay?: ReactNode;
  chrome?: CanvasChrome;
  modifiedAt?: WorkflowRecord["modifiedAt"];
  state?: WorkflowRecord["state"];
  onDeleteWorkflow?: () => Promise<void>;
}

/** Public entry point: owns the `ReactFlowProvider` so `useReactFlow` is available below it. */
export function WorkflowCanvas(props: WorkflowCanvasProps) {
  const exportMode = useExportMode();
  const canvasId = props.canvasId ?? props.workflow.id;
  const layoutReady = useCanvasLayoutPersistence(canvasId, exportMode === null);
  if (!layoutReady) {
    return <div className={styles.wrapper} aria-busy="true" aria-label="Loading saved canvas layout" />;
  }
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function WorkflowCanvasInner({
  workflow,
  sourceChecks,
  canvasId: requestedCanvasId,
  itemLabel,
  exportEnabled = true,
  onNodeActivate,
  stageOverlay,
  chrome,
  modifiedAt,
  state,
  onDeleteWorkflow,
}: WorkflowCanvasProps) {
  const canvasId = requestedCanvasId ?? workflow.id;
  const reactFlowInstance = useReactFlow<CanvasFlowNode, WorkflowFlowEdge>();
  const reducedMotion = usePrefersReducedMotion();
  const exportMode = useExportMode();
  // A valid live edit keeps the same workflow id, so the id alone cannot tell `useCanvasFit`
  // that the graph's bounds changed. Source-check-only snapshots keep the workflow byte-identical
  // and therefore retain this key, avoiding an unnecessary reframe.
  const workflowRevision = useMemo(() => JSON.stringify(workflow), [workflow]);

  const theme = useCodeHQStore((state) => state.theme);
  const canvasLayout = useCodeHQStore((state) => state.canvasLayouts[canvasId]);
  const resetLayout = useCodeHQStore((state) => state.resetLayout);
  const saveNodePosition = useCodeHQStore((state) => state.saveNodePosition);
  const reconcileCanvasLayout = useCodeHQStore((state) => state.reconcileCanvasLayout);
  const layoutResetRevision = useCodeHQStore((state) => state.layoutResetRevision);
  const selectedStepId = useCodeHQStore((state) => state.selectedStepId);
  const stepPanRequest = useCodeHQStore((state) => state.stepPanRequest);
  const selectStep = useCodeHQStore((state) => state.selectStep);
  const setCanvasView = useCodeHQStore((state) => state.setCanvasView);

  // The view is picked from the map's shape when it opens and then stays put: a live edit that
  // turns a chain into a branching map only offers the better view, it never moves the map itself.
  const [opened, setOpened] = useState(() => ({ canvasId, view: chooseCanvasView(workflow) }));
  if (opened.canvasId !== canvasId) {
    setOpened({ canvasId, view: chooseCanvasView(workflow) });
  }
  const openedView = opened.canvasId === canvasId ? opened.view : chooseCanvasView(workflow);
  const view: CanvasView = canvasLayout?.view ?? openedView;
  const suggestedView = useMemo(() => chooseCanvasView(workflow), [workflow]);
  const [dismissedHint, setDismissedHint] = useState<{ canvasId: string; view: CanvasView } | null>(null);
  const showViewHint = suggestedView !== view && suggestedView !== openedView
    && !(dismissedHint?.canvasId === canvasId && dismissedHint.view === suggestedView);
  const changeView = useCallback((next: CanvasView) => {
    if (next !== view) {
      setCanvasView(canvasId, next, view);
    }
  }, [canvasId, setCanvasView, view]);

  const layout = useMemo(() => computeLayout(workflow, { view }), [workflow, view]);
  const backEdgeIds = useMemo(() => computeBackEdgeIds(workflow), [workflow]);

  // Path tracing follows the pointer only. Focus and selection outlive the gesture that set
  // them (closing a step card hands focus back to its node), so tracing them left the board
  // dimmed after the user had moved on.
  const [hoveredStepId, setHoveredStepId] = useState<string | null>(null);
  const [dragTrace, setDragTrace] = useState<{ pointerId: number; anchorId: string | null } | null>(null);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [imageExporting, setImageExporting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  // The legend row under the pointer: its edges stay, the rest fade.
  const [legendFocus, setLegendFocus] = useState<string | null>(null);
  const realStepIds = useMemo(() => new Set(workflow.steps.map((step) => step.id)), [workflow]);
  const visualSelectedStepId = imageExporting ? null : selectedStepId;
  const candidateTraceAnchorId = imageExporting ? null : dragTrace !== null ? dragTrace.anchorId : hoveredStepId;
  const traceAnchorId = candidateTraceAnchorId !== null && realStepIds.has(candidateTraceAnchorId) ? candidateTraceAnchorId : null;
  const tracePath = useMemo(
    () => (traceAnchorId !== null ? computeTracePath(workflow, traceAnchorId) : null),
    [workflow, traceAnchorId],
  );
  const onHoverStart = useCallback((stepId: string) => setHoveredStepId(stepId), []);
  const onHoverEnd = useCallback(() => setHoveredStepId(null), []);
  const handleClearSelection = useCallback(() => selectStep(null), [selectStep]);
  const handleSelectNode = useCallback((nodeId: string) => {
    selectStep(nodeId);
    onNodeActivate?.(nodeId);
  }, [onNodeActivate, selectStep]);

  // Cards the user dragged count toward the fit, or a card parked far away opens off screen.
  const fitBounds = useMemo(() => {
    const saved = canvasLayout?.nodePositions;
    if (saved === undefined || layout.nodes.length === 0) {
      return layout.bounds;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of layout.nodes) {
      const { x, y } = saved[node.id] ?? node;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + node.width);
      maxY = Math.max(maxY, y + node.height);
    }
    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
  }, [canvasLayout?.nodePositions, layout]);

  const { containerRef, overflowsRight, overflowsBottom, fitToViewport, updateOverflow } = useCanvasFit({
    layoutBounds: fitBounds,
    workflowId: canvasId,
    workflowRevision,
    reactFlowInstance,
    reducedMotion,
    ...(chrome !== undefined ? { insets: chrome.fitInsets } : {}),
  });

  // Moving nodes cross cards and edges under the pointer. Hold the starting trace so those
  // hover changes cannot repeatedly brighten and dim the whole graph during a drag.
  useEffect(() => {
    if (dragTrace === null) {
      return;
    }
    const finish = (event: PointerEvent): void => {
      if (event.pointerId !== dragTrace.pointerId) {
        return;
      }
      const node = event.type === "pointerup"
        ? document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-step-node]")
        : null;
      setHoveredStepId(node !== null && node !== undefined && containerRef.current?.contains(node)
        ? node.dataset.stepNode ?? null
        : null);
      setDragTrace(null);
    };
    const cancel = (): void => {
      setHoveredStepId(null);
      setDragTrace(null);
    };
    window.addEventListener("pointerup", finish, true);
    window.addEventListener("pointercancel", finish, true);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("pointerup", finish, true);
      window.removeEventListener("pointercancel", finish, true);
      window.removeEventListener("blur", cancel);
    };
  }, [containerRef, dragTrace]);

  const { getTabIndex, handleNodeKeyDown, setRovingId, panToNode } = useCanvasKeyboardNav({
    workflow,
    layoutNodes: layout.nodes,
    containerRef,
    reactFlowInstance,
    selectedStepId,
    onSelect: handleSelectNode,
    onClear: handleClearSelection,
    reducedMotion,
  });

  useLayoutEffect(() => {
    // In the island shell the step card pans itself into view when it opens.
    if (chrome !== undefined || stepPanRequest?.workflowId !== workflow.id) {
      return;
    }
    const drawerWidth = document.querySelector<HTMLElement>("[data-step-drawer]")?.getBoundingClientRect().width ?? 0;
    panToNode(stepPanRequest.stepId, drawerWidth);
  }, [chrome, panToNode, stepPanRequest, workflow.id]);

  const generatedNodes = useMemo(
    () => [
      ...buildFlowNodes({
        workflow,
        layout,
        backEdgeIds,
        sourceChecks,
        selectedStepId: visualSelectedStepId,
        traceStepIds: tracePath?.stepIds ?? null,
        getTabIndex,
        onNodeKeyDown: handleNodeKeyDown,
        onHoverStart,
        onHoverEnd,
      }),
    ],
    [
      workflow,
      layout,
      backEdgeIds,
      sourceChecks,
      visualSelectedStepId,
      tracePath,
      getTabIndex,
      handleNodeKeyDown,
      onHoverStart,
      onHoverEnd,
    ],
  );
  const initialNodes = useMemo(
    () => generatedNodes.map((node) => ({
      ...node,
      position: canvasLayout?.nodePositions[node.id] ?? node.position,
    })),
    [canvasLayout?.nodePositions, generatedNodes],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasFlowNode>(initialNodes);
  const previousWorkflowId = useRef(canvasId);
  const previousRevision = useRef(workflowRevision);
  const previousView = useRef(view);
  const handledLayoutResetRevision = useRef(layoutResetRevision);
  useLayoutEffect(() => {
    const reset = previousWorkflowId.current !== canvasId;
    // A new revision of the same workflow re-flows every card the user has not dragged: keeping
    // their old positions would stack them on the cards the new layout placed around them.
    // Expanding a card keeps positions, so the rest of the map holds still.
    // Switching views re-flows every card too, and the cards glide to their new places.
    const viewChanged = previousView.current !== view;
    const reflow = reset || viewChanged || previousRevision.current !== workflowRevision;
    previousWorkflowId.current = canvasId;
    previousRevision.current = workflowRevision;
    previousView.current = view;
    const from = new Map<string, { x: number; y: number }>();
    setNodes((current) => {
      const positions = new Map(current.map((node) => [node.id, node.position]));
      positions.forEach((position, id) => from.set(id, position));
      return generatedNodes.map((node) => ({
        ...node,
        position: reflow
          ? canvasLayout?.nodePositions[node.id] ?? node.position
          : positions.get(node.id) ?? canvasLayout?.nodePositions[node.id] ?? node.position,
      }));
    });
    if (!viewChanged || reset || reducedMotion) {
      return;
    }
    const to = new Map(generatedNodes.map((node) => [node.id, canvasLayout?.nodePositions[node.id] ?? node.position]));
    const at = (id: string, t: number) => {
      const start = from.get(id);
      const end = to.get(id);
      return start === undefined || end === undefined
        ? end
        : { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
    };
    const startedAt = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - startedAt) / VIEW_GLIDE_MS);
      const t = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      setNodes((current) => current.map((node) => ({ ...node, position: at(node.id, t) ?? node.position })));
      if (p < 1) {
        frame = requestAnimationFrame(step);
      }
    };
    setNodes((current) => current.map((node) => ({ ...node, position: at(node.id, 0) ?? node.position })));
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      setNodes((current) => current.map((node) => ({ ...node, position: to.get(node.id) ?? node.position })));
    };
  }, [canvasId, canvasLayout?.nodePositions, generatedNodes, reducedMotion, setNodes, view, workflowRevision]);
  // A new view has new bounds: frame it while the cards glide.
  const framedView = useRef(view);
  useLayoutEffect(() => {
    if (framedView.current === view) {
      return;
    }
    framedView.current = view;
    fitToViewport(reducedMotion ? 0 : VIEW_GLIDE_MS);
  }, [fitToViewport, reducedMotion, view]);
  useLayoutEffect(() => {
    if (handledLayoutResetRevision.current === layoutResetRevision) {
      return;
    }
    handledLayoutResetRevision.current = layoutResetRevision;
    setNodes((current) => restoreGeneratedNodePositions(current, generatedNodes));
    fitToViewport(reducedMotion ? 0 : 400);
  }, [fitToViewport, generatedNodes, layoutResetRevision, reducedMotion, setNodes]);
  const baseEdges = useMemo(
    () => buildFlowEdges(layout, backEdgeIds, tracePath?.edgeIds ?? null),
    [layout, backEdgeIds, tracePath],
  );
  useEffect(() => {
    reconcileCanvasLayout(
      canvasId,
      new Set(layout.nodes.map((node) => node.id)),
    );
  }, [canvasId, layout.nodes, reconcileCanvasLayout]);
  const edges = useMemo(() => {
    const nodeBounds = new Map<string, { x: number; y: number; width: number; height: number }>();
    const initialPositions = new Map(
      layout.nodes.map((node) => [node.id, { x: node.x, y: node.y }]),
    );
    for (const node of nodes) {
      const width = node.measured?.width ?? node.width;
      const height = node.measured?.height ?? node.height;
      if (width !== undefined && height !== undefined) {
        nodeBounds.set(node.id, { x: node.position.x, y: node.position.y, width, height });
      }
    }

    return splitSharedSides(baseEdges.map((edge) => {
      if (edge.data?.retry === true || edge.data?.returnEdge === true) {
        return edge;
      }
      const source = nodeBounds.get(edge.source);
      const target = nodeBounds.get(edge.target);
      if (source === undefined || target === undefined) {
        return edge;
      }
      const sourceInitial = initialPositions.get(edge.source);
      const targetInitial = initialPositions.get(edge.target);
      const atRest = sourceInitial !== undefined && targetInitial !== undefined
        && source.x === sourceInitial.x && source.y === sourceInitial.y
        && target.x === targetInitial.x && target.y === targetInitial.y;
      const routed = edge.data?.branch === true || edge.data?.turnY !== undefined;
      if (atRest && routed) {
        return edge;
      }
      const handles = chooseViewHandles(layout.view, source, target, edge.data?.branch === true);
      if (edge.data?.turnY !== undefined) {
        // A dragged card leaves its row, so its row-turn route no longer fits.
        const data = { ...edge.data };
        delete data.turnY;
        return { ...edge, ...handles, data };
      }
      return edge.sourceHandle === handles.sourceHandle && edge.targetHandle === handles.targetHandle
        ? edge
        : { ...edge, ...handles };
    }), nodeBounds);
  }, [baseEdges, layout, nodes]);

  const live = useLiveBuild(canvasId, workflow, workflowRevision, layout, nodes, reducedMotion);
  const shownNodes = useMemo(() => live.decorateNodes(nodes), [live, nodes]);
  const shownEdges = useMemo(() => live.decorateEdges(edges), [edges, live]);

  const handleNodeClick: NodeMouseHandler<CanvasFlowNode> = (_event, node) => {
    handleSelectNode(node.id);
    setRovingId(node.id);
  };

  // The overflow cues pan most of a screen toward the hidden part of the map.
  const panCanvas = useCallback((direction: "right" | "bottom") => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect === undefined) {
      return;
    }
    const viewport = reactFlowInstance.getViewport();
    void reactFlowInstance.setViewport(
      direction === "right"
        ? { ...viewport, x: viewport.x - rect.width * 0.6 }
        : { ...viewport, y: viewport.y - rect.height * 0.6 },
      { duration: reducedMotion ? 0 : 300 },
    );
  }, [containerRef, reactFlowInstance, reducedMotion]);

  const handleExport = useCallback(() => setExportDialogOpen(true), []);
  const downloadExport = useCallback(async (hideFilePaths: boolean): Promise<void> => {
    const artifact = await fetchWorkflowExport(workflow.id, hideFilePaths);
    const url = URL.createObjectURL(artifact.blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = artifact.filename;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [workflow.id]);
  const downloadImage = useCallback(async (): Promise<void> => {
    const viewport = containerRef.current?.querySelector<HTMLElement>(".react-flow__viewport");
    if (viewport === undefined || viewport === null || nodes.length === 0) {
      throw new Error("The diagram is not ready. Wait for it to load, then try again.");
    }

    setImageExporting(true);
    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const bounds = getNodesBounds(nodes);
      const paddedBounds = {
        x: bounds.x - IMAGE_PADDING,
        y: bounds.y - IMAGE_PADDING,
        width: bounds.width + IMAGE_PADDING * 2,
        height: bounds.height + IMAGE_PADDING * 2,
      };
      const width = Math.min(MAX_IMAGE_SIZE, Math.max(MIN_IMAGE_SIZE, Math.ceil(paddedBounds.width)));
      const height = Math.min(MAX_IMAGE_SIZE, Math.max(MIN_IMAGE_SIZE, Math.ceil(paddedBounds.height)));
      const transform = getViewportForBounds(paddedBounds, width, height, 0.01, 1, 0);
      const backgroundColor = getComputedStyle(containerRef.current as HTMLElement).backgroundColor;
      const dataUrl = await toPng(viewport, {
        backgroundColor,
        width,
        height,
        pixelRatio: 1,
        style: {
          width: `${width}px`,
          height: `${height}px`,
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.zoom})`,
        },
        filter: (element) => !(element instanceof HTMLButtonElement),
      });
      const filenameBase = workflow.name
        .replace(/[^a-zA-Z0-9-_ ]/g, "")
        .trim()
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .toLowerCase()
        .slice(0, 80) || "workflow";
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = `${filenameBase}-hqflow.png`;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown image error";
      throw new Error(`Could not create the diagram image: ${detail}`);
    } finally {
      setImageExporting(false);
    }
  }, [containerRef, nodes, workflow.name]);
  const shareExport = useCallback(async (hideFilePaths: boolean): Promise<void> => {
    const artifact = await fetchWorkflowExport(workflow.id, hideFilePaths);
    const file = new File([artifact.blob], artifact.filename, { type: "text/html" });
    const shareData = { files: [file], title: workflow.name, text: "HQFlow workflow export" };
    if (typeof navigator.share === "function" && (typeof navigator.canShare !== "function" || navigator.canShare(shareData))) {
      await navigator.share(shareData);
      return;
    }
    await downloadExport(hideFilePaths);
  }, [downloadExport, workflow.id, workflow.name]);

  const stepNodeCount = nodes.filter((node) => node.type === "step").length;
  const showMinimap = stepNodeCount > MINIMAP_NODE_THRESHOLD;
  const minimapStrokeWidth = Math.max(2, Math.max(layout.bounds.width, layout.bounds.height) / MINIMAP_MIN_FEATURE_DIVISOR);
  const titleProps = {
    workflow,
    ...(itemLabel !== undefined ? { itemLabel } : {}),
    ...(modifiedAt !== undefined ? { modifiedAt } : {}),
    ...(state !== undefined ? { state } : {}),
  };
  const toolbarProps = {
    onZoomIn: () => void reactFlowInstance.zoomIn({ duration: reducedMotion ? 0 : 150 }),
    onZoomOut: () => void reactFlowInstance.zoomOut({ duration: reducedMotion ? 0 : 150 }),
    onFit: () => fitToViewport(reducedMotion ? 0 : 300),
    onResetLayout: () => resetLayout(canvasId),
    ...(exportMode === null ? { onReplay: live.replay } : {}),
    viewSwitch: { view, autoView: suggestedView, onViewChange: changeView },
    legend: { rows: legendRows(workflow), onHighlight: setLegendFocus },
    ...(exportMode === null && exportEnabled ? { onExport: handleExport } : {}),
    ...(exportMode === null && onDeleteWorkflow !== undefined && state !== "stale"
      ? { onDelete: () => setDeleteDialogOpen(true) }
      : {}),
  };

  return (
    <div className={styles.wrapper} data-image-exporting={imageExporting ? "true" : undefined}>
      {chrome === undefined ? (
        <CanvasHeader {...titleProps} {...toolbarProps} />
      ) : (
        <>
          {chrome.titleTarget !== null ? createPortal(<CanvasTitle {...titleProps} />, chrome.titleTarget) : null}
          {chrome.controlsTarget !== null ? createPortal(<CanvasDockControls {...toolbarProps} />, chrome.controlsTarget) : null}
        </>
      )}
      <div
        className={styles.stage}
        ref={containerRef}
        data-legend-focus={legendFocus ?? undefined}
        onPointerDownCapture={(event) => {
          if (event.button === 0 && event.target instanceof Element
            && event.target.closest("[data-step-node]") !== null) {
            setDragTrace({ pointerId: event.pointerId, anchorId: traceAnchorId });
          }
        }}
      >
        {stageOverlay}
        <EdgeMarkers />
        <ReactFlow
          className={styles.flow}
          colorMode={theme}
          nodes={shownNodes}
          edges={shownEdges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          // Cards hold still while a live build draws them in.
          nodesDraggable={live.plan === null}
          nodesConnectable={false}
          nodesFocusable={false}
          elementsSelectable={false}
          disableKeyboardA11y
          minZoom={0.2}
          maxZoom={2}
          onlyRenderVisibleElements={!imageExporting && nodes.length > VIRTUALIZE_NODE_THRESHOLD}
          onMove={(_event, viewport) => updateOverflow(viewport)}
          // Only the reader's own gestures count; a programmatic fit or pan has no event.
          onMoveStart={(event) => { if (event !== null) chrome?.onCanvasMove(true); }}
          onMoveEnd={(event) => { if (event !== null) chrome?.onCanvasMove(false); }}
          onNodeDragStart={() => chrome?.onCanvasMove(true)}
          onNodeDragStop={(_event, node) => {
            chrome?.onCanvasMove(false);
            saveNodePosition(canvasId, node.id, node.position);
          }}
          onNodeClick={handleNodeClick}
          onNodesChange={onNodesChange}
          onPaneClick={handleClearSelection}
          aria-label={`${workflow.name} workflow canvas`}
        >
          {showMinimap ? (
            <MiniMap
              pannable
              zoomable={false}
              ariaLabel={`${workflow.name} overview map`}
              // Node strokes are in canvas units; scaling them with the graph keeps a long, thin
              // chain from shrinking below one pixel tall in the map. The mask stroke is already
              // in screen pixels.
              nodeStrokeWidth={minimapStrokeWidth}
              nodeStrokeColor="var(--xy-minimap-node-background-color)"
              maskStrokeWidth={2}
              maskStrokeColor="var(--accent-neutral)"
            />
          ) : null}
          {live.plan !== null ? <AgentCursor key={live.plan.id} plan={live.plan} /> : null}
          {chrome !== undefined ? (
            <StepCardLayer
              workflow={workflow}
              sourceChecks={sourceChecks}
              nodes={nodes}
              bounds={layout.bounds}
              insets={chrome.fitInsets}
              containerRef={containerRef}
              reducedMotion={reducedMotion}
            />
          ) : null}
        </ReactFlow>
        {chrome === undefined ? <CanvasLegend workflow={workflow} dimmed={tracePath !== null} /> : null}
        {showViewHint ? (
          <CanvasViewHint
            view={view}
            suggestedView={suggestedView}
            onSwitch={() => changeView(suggestedView)}
            onDismiss={() => setDismissedHint({ canvasId, view: suggestedView })}
            {...(chrome !== undefined ? { bottomInset: chrome.fitInsets.bottom } : {})}
          />
        ) : null}
        {live.plan !== null ? <BuildToast key={live.plan.id} plan={live.plan} fileName={`${workflow.id}.json`} /> : null}
        {overflowsRight ? <CanvasOverflowIndicator direction="right" onPan={panCanvas} /> : null}
        {overflowsBottom ? (
          <CanvasOverflowIndicator direction="bottom" onPan={panCanvas} {...(chrome !== undefined ? { bottomInset: chrome.dockClearance } : {})} />
        ) : null}
      </div>
      {exportDialogOpen ? (
        <ExportDialog
          workflowName={workflow.name}
          onClose={() => setExportDialogOpen(false)}
          onDownloadImage={downloadImage}
          onDownloadHtml={downloadExport}
          onShare={shareExport}
        />
      ) : null}
      {deleteDialogOpen && onDeleteWorkflow !== undefined ? (
        <DeleteWorkflowDialog
          workflowName={workflow.name}
          onClose={() => setDeleteDialogOpen(false)}
          onConfirm={async () => {
            await onDeleteWorkflow();
            setDeleteDialogOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
