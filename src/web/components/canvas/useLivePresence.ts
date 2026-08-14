/** Owns same-workflow presence state, snapshot reconcile, and the single agent-cursor session. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { Workflow } from "@schema/workflow";
import {
  applyPresenceToEdges,
  applyPresenceToNodes,
  buildPresenceView,
  collectNodeCenters,
  flushPresence,
  hasPresenceWork,
  projectPresenceGraph,
  reconcilePresence,
  runPresenceSession,
  sampleSvgPath,
  type PresenceDriver,
  type PresenceGraph,
  type PresencePoint,
  type PresenceState,
  type PresenceView,
} from "./livePresence";
import { collectNodeBoxes } from "./cardGeometry";
import type { CanvasFlowNode, WorkflowFlowEdge } from "./types";

export interface UseLivePresenceParams {
  workflow: Workflow;
  flush: boolean;
  containerRef: RefObject<HTMLElement | null>;
  driver?: PresenceDriver;
}

export interface UseLivePresenceResult {
  view: PresenceView;
  cursorRef: RefObject<HTMLDivElement | null>;
  decorateNodes: (nodes: CanvasFlowNode[]) => CanvasFlowNode[];
  decorateEdges: (edges: WorkflowFlowEdge[]) => WorkflowFlowEdge[];
  observeNodes: (nodes: readonly CanvasFlowNode[]) => void;
}

interface PresenceBundle {
  graph: PresenceGraph;
  flush: boolean;
  state: PresenceState;
}

export function useLivePresence({ workflow, flush, containerRef, driver }: UseLivePresenceParams): UseLivePresenceResult {
  const graph = useMemo(() => projectPresenceGraph(workflow), [workflow]);
  const [bundle, setBundle] = useState<PresenceBundle>(() => ({
    graph,
    flush,
    state: flushPresence(graph),
  }));
  const state = bundle.graph !== graph || bundle.flush !== flush
    ? reconcilePresence(bundle.state, graph, { flush })
    : bundle.state;

  if (bundle.graph !== graph || bundle.flush !== flush) {
    setBundle({ graph, flush, state });
  }

  const view = useMemo(() => buildPresenceView(state), [state]);
  const cursorRef = useRef<HTMLDivElement>(null);
  const lastPointRef = useRef<PresencePoint | null>(null);
  const nodesRef = useRef<readonly CanvasFlowNode[]>([]);
  const stateRef = useRef(state);
  const runningRef = useRef(false);
  const kickRef = useRef<(() => void) | null>(null);

  const observeNodes = useCallback((nodes: readonly CanvasFlowNode[]): void => {
    nodesRef.current = nodes;
    kickRef.current?.();
  }, []);
  const decorateNodes = useCallback((nodes: CanvasFlowNode[]): CanvasFlowNode[] => applyPresenceToNodes(nodes, view), [view]);
  const decorateEdges = useCallback((edges: WorkflowFlowEdge[]): WorkflowFlowEdge[] => applyPresenceToEdges(edges, view), [view]);

  useLayoutEffect(() => {
    stateRef.current = state;
    if (flush || bundle.state.workflowId !== graph.workflowId) {
      lastPointRef.current = null;
    }
  }, [bundle.state.workflowId, flush, graph.workflowId, state]);

  useEffect(() => {
    if (flush) {
      return;
    }

    const controller = new AbortController();
    const activeDriver = driver ?? createBrowserPresenceDriver(cursorRef, lastPointRef);
    const commit = (next: PresenceState): void => {
      stateRef.current = next;
      setBundle((current) => ({ ...current, state: next }));
    };
    const start = (): void => {
      if (runningRef.current || controller.signal.aborted || !hasPresenceWork(stateRef.current)) {
        return;
      }
      runningRef.current = true;
      void runPresenceSession({
        getState: () => stateRef.current,
        setState: commit,
        getPositions: () => collectNodeCenters(nodesRef.current),
        getBoxes: () => collectNodeBoxes(nodesRef.current),
        getCursor: () => lastPointRef.current,
        sampleEdge: (renderId) => sampleRenderedEdge(containerRef.current, renderId),
        driver: activeDriver,
        signal: controller.signal,
      }).finally(() => {
        runningRef.current = false;
        if (!controller.signal.aborted && hasPresenceWork(stateRef.current)) {
          start();
        }
      });
    };

    kickRef.current = start;
    start();
    const cursor = cursorRef.current;
    return () => {
      kickRef.current = null;
      controller.abort();
      runningRef.current = false;
      cancelCursorAnimation(cursor);
    };
  }, [containerRef, driver, flush, workflow.id]);

  useEffect(() => {
    kickRef.current?.();
  }, [state.pendingNodeIds, state.pendingEdgeKeys, state.active, flush, view]);

  return { view, cursorRef, decorateNodes, decorateEdges, observeNodes };
}

export function createBrowserPresenceDriver(
  cursorRef: RefObject<HTMLDivElement | null>,
  lastPointRef: RefObject<PresencePoint | null>,
): PresenceDriver {
  return {
    sleep(ms, signal) {
      return sleepWithSignal(ms, signal);
    },
    async animateCursor(points, ms, signal, easing = "cubic-bezier(0.4, 0, 0.2, 1)") {
      const last = points[points.length - 1];
      if (last !== undefined) {
        lastPointRef.current = last;
      }
      const element = cursorRef.current;
      if (element === null || points.length === 0) {
        return;
      }
      const keyframes = points.map((point) => ({ transform: `translate(${point.x}px, ${point.y}px)` }));
      if (ms <= 0 || points.length === 1) {
        element.style.transform = `translate(${last?.x ?? 0}px, ${last?.y ?? 0}px)`;
        return;
      }
      cancelCursorAnimation(element);
      const animation = element.animate(keyframes, {
        duration: ms,
        easing,
        fill: "forwards",
      });
      try {
        await waitForAnimation(animation, signal);
      } finally {
        if (last !== undefined) {
          element.style.transform = `translate(${last.x}px, ${last.y}px)`;
        }
      }
    },
  };
}

export function sleepWithSignal(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function waitForAnimation(animation: Animation, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      animation.cancel();
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const finish = (): void => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = (): void => {
      animation.cancel();
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void animation.finished.then(finish, finish);
  });
}

function cancelCursorAnimation(element: HTMLDivElement | null): void {
  if (element === null) {
    return;
  }
  for (const animation of element.getAnimations()) {
    animation.cancel();
  }
}

function sampleRenderedEdge(container: HTMLElement | null, renderId: string): { points: PresencePoint[]; length: number } | null {
  const root = container ?? document;
  const group = root.querySelector(`[data-workflow-edge="${cssEscape(renderId)}"]`);
  const path = group?.querySelector<SVGPathElement>("path.react-flow__edge-path") ?? group?.querySelector("path");
  return path === null || path === undefined ? null : sampleSvgPath(path);
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/[\s!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~]/g, "\\$&");
}
