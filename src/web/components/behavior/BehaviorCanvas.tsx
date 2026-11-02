import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import { createPortal } from "react-dom";
import { ReactFlow, ReactFlowProvider, useReactFlow, ViewportPortal, type Node, type NodeProps } from "@xyflow/react";
import { behaviorAsWorkflow, type Behavior, type VerdictStatus } from "@schema/behavior";
import type { BehaviorRecord, WorkflowRecord } from "../../api/types";
import { usePrefersReducedMotion } from "../../lib/usePrefersReducedMotion";
import { useCodeHQStore } from "../../store/useCodeHQStore";
import type { CanvasChrome } from "../canvas";
import { CanvasDockControls } from "../canvas/CanvasDockControls";
import { CanvasTitle } from "../canvas/CanvasHeader";
import { StepCardLayer } from "../canvas/StepCardLayer";
import { useCanvasFit } from "../canvas/useCanvasFit";
import canvasStyles from "../canvas/WorkflowCanvas.module.css";
import { MomentDetails } from "./MomentDetails";
import { layoutStoryTree, type StoryTree } from "./storyTree";
import styles from "./BehaviorCanvas.module.css";

export interface BehaviorCanvasProps {
  record: BehaviorRecord;
  workflows: readonly WorkflowRecord[];
  chrome?: CanvasChrome;
}

type Verdict = VerdictStatus | "none";
const VERDICT_LABELS: Record<Verdict, string> = { works: "Works", bug: "Bug found", fixed: "Fixed", none: "Not checked" };

interface StoryNodeData extends Record<string, unknown> {
  name: string;
  verdict: Verdict;
  kind: "moment" | "jump";
  momentId: string;
  back?: boolean;
}
type StoryFlowNode = Node<StoryNodeData, "story">;

/** A moment box coloured by its verdict, or a pill that jumps to a moment already in the tree. */
// Clicks reach the canvas's `onNodeClick`; a node without a click handler gets no pointer events.
function StoryNodeView({ id, data }: NodeProps<StoryFlowNode>) {
  const selected = useCodeHQStore((state) => state.selectedStepId === data.momentId);
  if (data.kind === "jump") {
    return (
      <button type="button" className={styles.jump} aria-label={`Goes to ${data.name}`}>
        <span aria-hidden="true">{data.back === true ? "↩ back to" : "→ on to"}</span> {data.name}
      </button>
    );
  }
  return (
    <button
      type="button"
      className={`${styles.moment}${selected ? ` ${styles.selected}` : ""}`}
      data-verdict={data.verdict}
      data-step-node={id}
      aria-label={`${data.name}. ${VERDICT_LABELS[data.verdict]}.`}
      aria-pressed={selected}
    >
      {data.name}
    </button>
  );
}

const NODE_TYPES = { story: StoryNodeView };

/** The arrows, their event labels, the start dot, the decision diamonds, and the verdict key. */
function StoryLines({ tree, verdicts }: { tree: StoryTree; verdicts: Verdict[] }) {
  const { width, height } = tree.bounds;
  return (
    <ViewportPortal>
      <div className={styles.lines} style={{ width, height }}>
        <svg width={width} height={height} aria-hidden="true">
          <defs>
            <marker id="story-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
              <path d="M1,1 L9,5 L1,9" className={styles.arrowHead} />
            </marker>
          </defs>
          {tree.edges.map((edge) => (
            <path key={edge.id} d={edge.path} className={styles.line} markerEnd={edge.arrow ? "url(#story-arrow)" : undefined} />
          ))}
        </svg>
        {tree.starts.map((dot) => <span key={`${dot.x}`} className={styles.start} style={{ left: dot.x, top: dot.y }} />)}
        {tree.diamonds.map((diamond) => <span key={`${diamond.x},${diamond.y}`} className={styles.diamond} style={{ left: diamond.x, top: diamond.y }} />)}
        {tree.edges.map((edge) => edge.label !== undefined ? (
          <span key={edge.id} className={styles.label} data-verdict={edge.label.verdict} style={{ left: edge.label.x, top: edge.label.y }}>
            {edge.label.text}
          </span>
        ) : null)}
        <div className={styles.key} aria-label="Verdict key">
          <span>Key</span>
          {verdicts.map((verdict) => <span key={verdict} className={styles.keyChip} data-verdict={verdict}>{VERDICT_LABELS[verdict]}</span>)}
        </div>
      </div>
    </ViewportPortal>
  );
}

function momentVerdict(behavior: Behavior, momentId: string): Verdict {
  return behavior.moments.find((moment) => moment.id === momentId)?.verdict?.status ?? "none";
}

/**
 * A behavior map is its own picture, not a workflow: a story tree of what the user sees, with each
 * box coloured by what the agent proved about it. Opening a moment shows its proof and the
 * workflow steps that cause it.
 */
export function BehaviorCanvas(props: BehaviorCanvasProps) {
  return (
    <ReactFlowProvider>
      <BehaviorCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function BehaviorCanvasInner({ record, workflows, chrome }: BehaviorCanvasProps) {
  const { behavior } = record;
  const reactFlow = useReactFlow();
  const reducedMotion = usePrefersReducedMotion();
  const theme = useCodeHQStore((state) => state.theme);
  const selectStep = useCodeHQStore((state) => state.selectStep);

  const workflow = useMemo(() => behaviorAsWorkflow(behavior), [behavior]);
  const tree = useMemo(() => layoutStoryTree(behavior), [behavior]);
  const nodes = useMemo<StoryFlowNode[]>(() => tree.nodes.map((node) => ({
    id: node.id,
    type: "story",
    position: { x: node.x, y: node.y },
    width: node.width,
    height: node.height,
    draggable: false,
    data: {
      name: behavior.moments.find((moment) => moment.id === node.momentId)?.name ?? node.momentId,
      verdict: momentVerdict(behavior, node.momentId),
      kind: node.kind,
      momentId: node.momentId,
      ...(node.back !== undefined ? { back: node.back } : {}),
    },
  })), [behavior, tree]);
  const verdicts = useMemo(() => (["works", "bug", "fixed", "none"] as const)
    .filter((verdict) => behavior.moments.some((moment) => (moment.verdict?.status ?? "none") === verdict)), [behavior]);

  const { containerRef, fitToViewport } = useCanvasFit({
    layoutBounds: tree.bounds,
    workflowId: `behavior:${record.id}`,
    workflowRevision: JSON.stringify(behavior),
    reactFlowInstance: reactFlow,
    reducedMotion,
    ...(chrome !== undefined ? { insets: chrome.fitInsets } : {}),
  });
  const fit = () => fitToViewport(reducedMotion ? 0 : 300);

  return (
    <div className={canvasStyles.wrapper}>
      {chrome?.titleTarget != null ? createPortal(<CanvasTitle workflow={workflow} itemLabel="moment" modifiedAt={record.modifiedAt} state={record.state} />, chrome.titleTarget) : null}
      {chrome?.controlsTarget != null ? createPortal(
        <CanvasDockControls
          onZoomIn={() => void reactFlow.zoomIn({ duration: reducedMotion ? 0 : 200 })}
          onZoomOut={() => void reactFlow.zoomOut({ duration: reducedMotion ? 0 : 200 })}
          onFit={fit}
          onResetLayout={fit}
        />,
        chrome.controlsTarget,
      ) : null}
      <div className={canvasStyles.stage} ref={containerRef}>
        <ReactFlow
          className={`${canvasStyles.flow} ${styles.flow}`}
          colorMode={theme}
          nodes={nodes}
          edges={[]}
          nodeTypes={NODE_TYPES}
          nodesDraggable={false}
          nodesConnectable={false}
          nodesFocusable={false}
          elementsSelectable={false}
          disableKeyboardA11y
          minZoom={0.2}
          maxZoom={2}
          onMoveStart={(event) => { if (event !== null) chrome?.onCanvasMove(true); }}
          onMoveEnd={(event) => { if (event !== null) chrome?.onCanvasMove(false); }}
          onNodeClick={(_event, node) => {
            const { momentId, kind } = node.data;
            selectStep(kind === "moment" && useCodeHQStore.getState().selectedStepId === momentId ? null : momentId);
          }}
          onPaneClick={() => selectStep(null)}
          aria-label={`${behavior.name} behavior map`}
        >
          <StoryLines tree={tree} verdicts={verdicts} />
          {chrome !== undefined ? (
            <StepCardLayer
              workflow={workflow}
              sourceChecks={record.sourceChecks}
              nodes={nodes.filter((node) => node.data.kind === "moment")}
              bounds={tree.bounds}
              insets={chrome.fitInsets}
              containerRef={containerRef}
              reducedMotion={reducedMotion}
              moments
              stepDetails={(momentId) => {
                const moment = behavior.moments.find((candidate) => candidate.id === momentId);
                return moment !== undefined ? <MomentDetails behavior={behavior} moment={moment} workflows={workflows} /> : null;
              }}
            />
          ) : null}
        </ReactFlow>
      </div>
    </div>
  );
}
