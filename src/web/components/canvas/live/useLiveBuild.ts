import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Workflow } from "@schema/workflow";
import { categoryToken } from "../../../design/semantics";
import { useCodeHQStore } from "../../../store/useCodeHQStore";
import type { LayoutResult } from "../layout";
import type { CanvasFlowNode, WorkflowFlowEdge } from "../types";
import { planBuild, type BuildPlan } from "./buildPlan";
import "./liveBuild.css";

/** Extra time after the last stroke so the glow can fade before the decorations come off. */
const SETTLE_MS = 1500;

const CLIP_FROM: Record<number, string> = {
  0: "inset(0 0 100% 0 round 10px)",
  90: "inset(0 0 0 100% round 10px)",
  180: "inset(100% 0 0 0 round 10px)",
  270: "inset(0 100% 0 0 round 10px)",
};

/**
 * Turns each valid live edit of the open workflow into a short drawing: the agent cursor inks the
 * new edges and traces the new cards, changed cards get a sheen. `replay()` redraws the whole map
 * from an empty canvas. Switching workflows, reduced motion, and the "still" motion level skip
 * the drawing; the graph itself is never delayed.
 */
export function useLiveBuild(
  canvasId: string,
  workflow: Workflow,
  workflowRevision: string,
  layout: LayoutResult,
  nodes: CanvasFlowNode[],
  reducedMotion: boolean,
) {
  const motion = useCodeHQStore((state) => state.motion);
  const [plan, setPlan] = useState<BuildPlan | null>(null);
  const [replayToken, setReplayToken] = useState(0);
  const previous = useRef<{ canvasId: string; workflow: Workflow; revision: string; replay: number }>({
    canvasId,
    workflow,
    revision: workflowRevision,
    replay: 0,
  });
  const nodesRef = useRef(nodes);
  useLayoutEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);
  const counter = useRef(0);

  useLayoutEffect(() => {
    const last = previous.current;
    previous.current = { canvasId, workflow, revision: workflowRevision, replay: replayToken };
    const replaying = last.replay !== replayToken;
    if (last.canvasId !== canvasId || (!replaying && last.revision === workflowRevision)) {
      return;
    }
    if (reducedMotion || motion === "still") {
      return;
    }
    counter.current += 1;
    const positions = new Map(nodesRef.current.map((node) => [node.id, node.position]));
    const next = planBuild(replaying ? null : last.workflow, workflow, layout, (id) => positions.get(id), counter.current);
    if (next === null) {
      return;
    }
    setPlan(next);
    const timer = window.setTimeout(() => setPlan((current) => (current?.id === next.id ? null : current)), next.total + SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [canvasId, layout, motion, reducedMotion, replayToken, workflow, workflowRevision]);

  const decorateNodes = useCallback((list: CanvasFlowNode[]): CanvasFlowNode[] => {
    if (plan === null) {
      return list;
    }
    const set = plan.id % 2 === 0 ? "hq-build-b" : "hq-build-a";
    const steps = new Map(workflow.steps.map((step) => [step.id, step]));
    return list.map((node) => {
      const draw = plan.nodes.get(node.id);
      const changed = plan.changed.has(node.id);
      if (draw === undefined && !changed) {
        return node;
      }
      const accent = node.type === "outcome"
        ? node.data.tone === "failure" ? "var(--accent-red)" : "var(--accent-output)"
        : `var(${categoryToken(steps.get(node.id)?.category).varName})`;
      const style = {
        ...node.style,
        "--hq-accent": accent,
        ...(draw !== undefined
          ? {
              "--hq-delay": `${draw.delay}ms`,
              "--hq-dur": `${draw.duration}ms`,
              "--hq-from": `${draw.from}deg`,
              "--hq-clip": CLIP_FROM[draw.from] ?? CLIP_FROM[270],
            }
          : {}),
      } as CSSProperties;
      const className = [node.className, set, draw !== undefined ? "hq-build" : "", changed ? "hq-changed" : ""].filter(Boolean).join(" ");
      return { ...node, className, style };
    });
  }, [plan, workflow]);

  const decorateEdges = useCallback((list: WorkflowFlowEdge[]): WorkflowFlowEdge[] => {
    if (plan === null) {
      return list;
    }
    const set = plan.id % 2 === 0 ? "hq-build-b" : "hq-build-a";
    return list.map((edge) => {
      const draw = plan.edges.get(edge.id);
      return draw === undefined || edge.data === undefined ? edge : { ...edge, data: { ...edge.data, build: { ...draw, set } } };
    });
  }, [plan]);

  const replay = useCallback(() => setReplayToken((token) => token + 1), []);
  return useMemo(() => ({ plan, decorateNodes, decorateEdges, replay }), [decorateEdges, decorateNodes, plan, replay]);
}
