/** Loads and automatically saves one workflow's repository-local canvas state. */
import { useEffect, useState } from "react";
import {
  deleteWorkflowCanvasLayout,
  getWorkflowCanvasLayout,
  saveWorkflowCanvasLayout,
} from "../../api/client";
import type { WorkflowCanvasLayout } from "../../api/types";
import { useCodeHQStore } from "../../store/useCodeHQStore";

export function useCanvasLayoutPersistence(workflowId: string, enabled: boolean): boolean {
  const hydrateCanvasLayout = useCodeHQStore((state) => state.hydrateCanvasLayout);
  const [loadedWorkflowId, setLoadedWorkflowId] = useState<string | null>(enabled ? null : workflowId);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    let writes = Promise.resolve();
    const activate = (layout: WorkflowCanvasLayout | null): void => {
      if (cancelled) {
        return;
      }
      hydrateCanvasLayout(workflowId, layout);
      unsubscribe = useCodeHQStore.subscribe((state, previous) => {
        const nextLayout = state.canvasLayouts[workflowId];
        if (nextLayout === previous.canvasLayouts[workflowId]) {
          return;
        }
        writes = writes
          .then(() => nextLayout === undefined
            ? deleteWorkflowCanvasLayout(workflowId, true)
            : saveWorkflowCanvasLayout(workflowId, nextLayout, true))
          .catch(() => {
            // Keep the in-memory layout usable; a later canvas change starts a fresh save attempt.
          });
      });
      setLoadedWorkflowId(workflowId);
    };

    void getWorkflowCanvasLayout(workflowId)
      .then(activate)
      .catch(() => {
        // Persistence is an enhancement: keep the generated layout usable if storage is unavailable.
        activate(null);
      });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [enabled, hydrateCanvasLayout, workflowId]);

  return !enabled || loadedWorkflowId === workflowId;
}
