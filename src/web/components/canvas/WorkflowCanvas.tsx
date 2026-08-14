import "@xyflow/react/dist/style.css";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MiniMap, ReactFlow, ReactFlowProvider, useNodesState, useReactFlow, type NodeMouseHandler } from "@xyflow/react";
import type { Workflow } from "@schema/workflow";
import type { SourceStatus, WorkflowRecord } from "../../api/types";
import { usePrefersReducedMotion } from "../../lib/usePrefersReducedMotion";
import { useCodeHQStore } from "../../store/useCodeHQStore";
import { buildFlowEdges, buildFlowNodes, chooseCardinalHandles, restoreGeneratedNodePositions } from "./buildFlowElements";
import { CanvasLegend } from "./CanvasLegend";
import { CanvasHeader } from "./CanvasHeader";
import { CanvasOverflowIndicator } from "./CanvasOverflowIndicator";
import { EdgeMarkers } from "./edges/EdgeMarkers";
import { WorkflowEdge } from "./edges/WorkflowEdge";
import { prepareObstacleRoutingContext, type RouteObstacle } from "./edges/obstacleRouting";
import { computeBackEdgeIds, computeTracePath } from "./graph";
import { computeLayout } from "./layout";
import { OutcomeNode } from "./nodes/OutcomeNode";
import { StepNode } from "./nodes/StepNode";
import type { CanvasFlowNode, WorkflowFlowEdge } from "./types";
import { useExportMode } from "../../export-viewer/ExportModeContext";
import { fetchWorkflowExport } from "../../api/client";
import { DeleteWorkflowDialog } from "./DeleteWorkflowDialog";
import { ExportDialog } from "./ExportDialog";
import { useCanvasFit } from "./useCanvasFit";
import { useCanvasKeyboardNav } from "./useCanvasKeyboardNav";
import styles from "./WorkflowCanvas.module.css";

/** A minimap only earns its screen space once a graph is big enough to get lost in. Counted over
 * work-step nodes only, not outcome pills: an outcome is an endpoint a reader glances at, not
 * another unit of work to navigate, so a workflow with a handful of steps and a stack of outcome
 * pills beside them (post edge-grammar redesign, outcomes are now real nodes) should not suddenly
 * earn a minimap it didn't need when outcomes were just coloured terminal markers. Both bundled
 * example workflows (7 and 4 work steps) confirm this keeps the default 1440x900 view intrusion-
 * free while still growing in for a genuinely large workflow. */
const MINIMAP_NODE_THRESHOLD = 10;

const NODE_TYPES = { step: StepNode, outcome: OutcomeNode };
const EDGE_TYPES = { workflow: WorkflowEdge };

export interface WorkflowCanvasProps {
  workflow: Workflow;
  sourceChecks: Record<string, SourceStatus>;
  modifiedAt?: WorkflowRecord["modifiedAt"];
  state?: WorkflowRecord["state"];
  onDeleteWorkflow?: () => Promise<void>;
}

/** Public entry point: owns the `ReactFlowProvider` so `useReactFlow` is available below it. */
export function WorkflowCanvas(props: WorkflowCanvasProps) {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function WorkflowCanvasInner({ workflow, sourceChecks, modifiedAt, state, onDeleteWorkflow }: WorkflowCanvasProps) {
  const reactFlowInstance = useReactFlow<CanvasFlowNode, WorkflowFlowEdge>();
  const reducedMotion = usePrefersReducedMotion();
  const exportMode = useExportMode();
  // A valid live edit keeps the same workflow id, so the id alone cannot tell `useCanvasFit`
  // that the graph's bounds changed. Source-check-only snapshots keep the workflow byte-identical
  // and therefore retain this key, avoiding an unnecessary reframe.
  const workflowRevision = useMemo(() => JSON.stringify(workflow), [workflow]);

  const theme = useCodeHQStore((state) => state.theme);
  const expandedStepIds = useCodeHQStore((state) => state.expandedStepIds);
  const toggleStepExpanded = useCodeHQStore((state) => state.toggleStepExpanded);
  const collapseAllSteps = useCodeHQStore((state) => state.collapseAllSteps);
  const resetLayout = useCodeHQStore((state) => state.resetLayout);
  const layoutResetRevision = useCodeHQStore((state) => state.layoutResetRevision);
  const selectedStepId = useCodeHQStore((state) => state.selectedStepId);
  const stepPanRequest = useCodeHQStore((state) => state.stepPanRequest);
  const selectStep = useCodeHQStore((state) => state.selectStep);

  const layout = useMemo(() => computeLayout(workflow, { expandedStepIds }), [workflow, expandedStepIds]);
  const backEdgeIds = useMemo(() => computeBackEdgeIds(workflow), [workflow]);

  // Path tracing (contract §11): hover wins over keyboard focus, which wins over the persisted
  // selection, matching how each one takes over the user's attention — a hover is the most
  // momentary/explicit signal, selection the most passive/lingering one.
  const [hoveredStepId, setHoveredStepId] = useState<string | null>(null);
  const [focusedStepId, setFocusedStepId] = useState<string | null>(null);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const realStepIds = useMemo(() => new Set(workflow.steps.map((step) => step.id)), [workflow]);
  const candidateTraceAnchorId = hoveredStepId ?? focusedStepId ?? selectedStepId;
  const traceAnchorId = candidateTraceAnchorId !== null && realStepIds.has(candidateTraceAnchorId) ? candidateTraceAnchorId : null;
  const tracePath = useMemo(
    () => (traceAnchorId !== null ? computeTracePath(workflow, traceAnchorId) : null),
    [workflow, traceAnchorId],
  );
  const onHoverStart = useCallback((stepId: string) => setHoveredStepId(stepId), []);
  const onHoverEnd = useCallback(() => setHoveredStepId(null), []);
  const onFocusStep = useCallback((stepId: string) => setFocusedStepId(stepId), []);
  const onBlurStep = useCallback(() => setFocusedStepId(null), []);
  const handleClearSelection = useCallback(() => selectStep(null), [selectStep]);

  const { containerRef, overflowsRight, overflowsBottom, updateOverflow } = useCanvasFit({
    layoutBounds: layout.bounds,
    workflowId: workflow.id,
    workflowRevision,
    reactFlowInstance,
    reducedMotion,
  });

  const { getTabIndex, handleNodeKeyDown, setRovingId, panToNode } = useCanvasKeyboardNav({
    workflow,
    layoutNodes: layout.nodes,
    containerRef,
    reactFlowInstance,
    selectedStepId,
    onSelect: selectStep,
    onClear: handleClearSelection,
    reducedMotion,
  });

  useLayoutEffect(() => {
    if (stepPanRequest?.workflowId !== workflow.id) {
      return;
    }
    const drawerWidth = document.querySelector<HTMLElement>("[data-step-drawer]")?.getBoundingClientRect().width ?? 0;
    panToNode(stepPanRequest.stepId, drawerWidth);
  }, [panToNode, stepPanRequest, workflow.id]);

  const generatedNodes = useMemo(
    () => [
      ...buildFlowNodes({
        workflow,
        layout,
        backEdgeIds,
        expandedStepIds,
        sourceChecks,
        selectedStepId,
        traceStepIds: tracePath?.stepIds ?? null,
        getTabIndex,
        onToggleExpand: toggleStepExpanded,
        onNodeKeyDown: handleNodeKeyDown,
        onHoverStart,
        onHoverEnd,
        onFocusStep,
        onBlurStep,
      }),
    ],
    [
      workflow,
      layout,
      backEdgeIds,
      expandedStepIds,
      sourceChecks,
      selectedStepId,
      tracePath,
      getTabIndex,
      toggleStepExpanded,
      handleNodeKeyDown,
      onHoverStart,
      onHoverEnd,
      onFocusStep,
      onBlurStep,
    ],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasFlowNode>(generatedNodes);
  const previousWorkflowId = useRef(workflow.id);
  const handledLayoutResetRevision = useRef(layoutResetRevision);
  useLayoutEffect(() => {
    const reset = previousWorkflowId.current !== workflow.id;
    previousWorkflowId.current = workflow.id;
    setNodes((current) => {
      const positions = new Map(current.map((node) => [node.id, node.position]));
      return generatedNodes.map((node) => reset ? node : { ...node, position: positions.get(node.id) ?? node.position });
    });
  }, [generatedNodes, setNodes, workflow.id]);
  useLayoutEffect(() => {
    if (handledLayoutResetRevision.current === layoutResetRevision) {
      return;
    }
    handledLayoutResetRevision.current = layoutResetRevision;
    setNodes((current) => restoreGeneratedNodePositions(current, generatedNodes));
  }, [generatedNodes, layoutResetRevision, setNodes]);
  const baseEdges = useMemo(
    () => buildFlowEdges(layout, backEdgeIds, tracePath?.edgeIds ?? null),
    [layout, backEdgeIds, tracePath],
  );
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
    const routeObstacles: RouteObstacle[] = Array.from(nodeBounds, ([id, bounds]) => ({ id, ...bounds }));
    const routingContext = prepareObstacleRoutingContext(routeObstacles);

    return baseEdges.map((edge) => {
      if (edge.data?.retry === true || edge.data?.returnEdge === true) {
        return edge;
      }
      const source = nodeBounds.get(edge.source);
      const target = nodeBounds.get(edge.target);
      if (source === undefined || target === undefined) {
        return edge;
      }
      const withObstacles = (candidate: WorkflowFlowEdge): WorkflowFlowEdge => {
        if (candidate.data === undefined) {
          return candidate;
        }
        return { ...candidate, data: { ...candidate.data, routingContext } };
      };
      const sourceInitial = initialPositions.get(edge.source);
      const targetInitial = initialPositions.get(edge.target);
      const outcomeAtRest = edge.data?.branch === true && sourceInitial !== undefined && targetInitial !== undefined
        && source.x === sourceInitial.x && source.y === sourceInitial.y
        && target.x === targetInitial.x && target.y === targetInitial.y;
      if (outcomeAtRest) {
        return withObstacles(edge);
      }
      const handles = chooseCardinalHandles(source, target);
      const nextEdge = edge.sourceHandle === handles.sourceHandle && edge.targetHandle === handles.targetHandle
        ? edge
        : { ...edge, ...handles };
      return withObstacles(nextEdge);
    });
  }, [baseEdges, layout, nodes]);

  const handleNodeClick: NodeMouseHandler<CanvasFlowNode> = (_event, node) => {
    selectStep(node.id);
    setRovingId(node.id);
  };

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

  const hasExpandedSteps = Object.keys(expandedStepIds).length > 0;
  const stepNodeCount = nodes.filter((node) => node.type === "step").length;
  const showMinimap = stepNodeCount > MINIMAP_NODE_THRESHOLD;

  return (
    <div className={styles.wrapper}>
      <CanvasHeader
        workflow={workflow}
        {...(modifiedAt !== undefined ? { modifiedAt } : {})}
        {...(state !== undefined ? { state } : {})}
        onZoomIn={() => void reactFlowInstance.zoomIn({ duration: reducedMotion ? 0 : 150 })}
        onZoomOut={() => void reactFlowInstance.zoomOut({ duration: reducedMotion ? 0 : 150 })}
        onResetLayout={resetLayout}
        onCollapseAll={collapseAllSteps}
        collapseDisabled={!hasExpandedSteps}
        {...(exportMode === null ? { onExport: handleExport } : {})}
        {...(exportMode === null && onDeleteWorkflow !== undefined && workflow.status === "verified"
          ? { onDelete: () => setDeleteDialogOpen(true) }
          : {})}
      />
      <div className={styles.stage} ref={containerRef}>
        <EdgeMarkers />
        <ReactFlow
          className={styles.flow}
          colorMode={theme}
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          nodesDraggable
          nodesConnectable={false}
          nodesFocusable={false}
          elementsSelectable={false}
          disableKeyboardA11y
          minZoom={0.2}
          maxZoom={2}
          onMove={(_event, viewport) => updateOverflow(viewport)}
          onNodeClick={handleNodeClick}
          onNodesChange={onNodesChange}
          onPaneClick={handleClearSelection}
          aria-label={`${workflow.name} workflow canvas`}
        >
          {showMinimap ? <MiniMap pannable zoomable={false} ariaLabel={`${workflow.name} overview map`} /> : null}
        </ReactFlow>
        <CanvasLegend workflow={workflow} dimmed={tracePath !== null} />
        {overflowsRight ? <CanvasOverflowIndicator direction="right" /> : null}
        {overflowsBottom ? <CanvasOverflowIndicator direction="bottom" /> : null}
      </div>
      {exportDialogOpen ? (
        <ExportDialog
          workflowName={workflow.name}
          onClose={() => setExportDialogOpen(false)}
          onDownload={downloadExport}
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
