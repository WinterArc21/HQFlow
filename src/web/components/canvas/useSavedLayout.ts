/**
 * Owns manually-saved canvas node positions — split out of `WorkflowCanvas.tsx` along the same seam 
 * as `useCanvasFit.ts`: fetching the saved layout for the current workflow, applying it once loaded, 
 * and exposing a "save current positions" action with the pending/error status the toolbar button needs.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getWorkflowLayout, saveWorkflowLayout, type WorkflowLayoutPositions } from "../../api/client";
import { useAsyncAction, type UseAsyncActionResult } from "../../lib/useAsyncAction";

interface PositionedNode {
  id: string;
  position: { x: number; y: number };
}

/** Tagged with the workflow it was fetched for, so a fetch that resolves after the workflow has
 * already changed again can be recognised as stale and ignored instead of being applied to the
 * wrong graph. */
interface FetchedLayout {
  workflowId: string;
  positions: WorkflowLayoutPositions;
}

export interface UseSavedLayoutParams<NodeType extends PositionedNode> {
  workflowId: string;
  nodes: NodeType[];
  setNodes: (updater: (current: NodeType[]) => NodeType[]) => void;
  /** False in the static export viewer, which has no server to fetch from or save to. */
  enabled: boolean;
}

export interface UseSavedLayoutResult {
  saveLayout: UseAsyncActionResult["run"];
  saveStatus: UseAsyncActionResult["status"];
  saveError: UseAsyncActionResult["message"];
  dismissSaveError: UseAsyncActionResult["reset"];
}

export function useSavedLayout<NodeType extends PositionedNode>({
  workflowId,
  nodes,
  setNodes,
  enabled,
}: UseSavedLayoutParams<NodeType>): UseSavedLayoutResult {
  const [fetched, setFetched] = useState<FetchedLayout | null>(null);
  const nodesRef = useRef(nodes);
  useEffect(() => {
    nodesRef.current = nodes;
  });

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let cancelled = false;
    getWorkflowLayout(workflowId)
      .then(({ positions }) => {
        if (!cancelled) {
          setFetched({ workflowId, positions });
        }
      })
      .catch(() => {
        // No saved layout yet (or the fetch failed) is not an error a user needs to see — the
        // canvas simply keeps the auto-computed layout, same as before this feature existed.
        if (!cancelled) {
          setFetched({ workflowId, positions: {} });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, workflowId]);

  useEffect(() => {
    if (fetched === null || fetched.workflowId !== workflowId || Object.keys(fetched.positions).length === 0) {
      return;
    }
    setNodes((current) =>
      current.map((node) => {
        const saved = fetched.positions[node.id];
        return saved !== undefined ? { ...node, position: saved } : node;
      }),
    );
  }, [fetched, workflowId, setNodes]);

  const runSave = useCallback(async (): Promise<void> => {
    const positions: WorkflowLayoutPositions = {};
    for (const node of nodesRef.current) {
      positions[node.id] = { x: node.position.x, y: node.position.y };
    }
    await saveWorkflowLayout(workflowId, positions);
  }, [workflowId]);
  const { run: saveLayout, status: saveStatus, message: saveError, reset: dismissSaveError } = useAsyncAction(runSave);

  return { saveLayout, saveStatus, saveError, dismissSaveError };
}
