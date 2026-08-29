import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

/**
 * UI state only (contract §11) — workflow/step/project data always comes from the server
 * snapshot (see `api/events.ts`) and never lives here.
 */

export type Theme = "dark" | "light";

export interface StepPanRequest {
  workflowId: string;
  stepId: string;
}

export interface CanvasPoint {
  x: number;
  y: number;
}

export type CanvasBendSnap = "source-x" | "target-x" | null;

export interface CanvasBend {
  point: CanvasPoint;
  snap: CanvasBendSnap;
}

export interface CanvasViewport extends CanvasPoint {
  zoom: number;
}

export interface WorkflowCanvasLayout {
  nodePositions: Record<string, CanvasPoint>;
  edgeBends: Record<string, CanvasBend>;
  viewport?: CanvasViewport;
  expandedStepIds: Record<string, true>;
}

/** Persist schema version — bump when migrating stored UI preferences. */
const PERSIST_VERSION = 3;

interface CodeHQUiState {
  selectedWorkflowId: string | null;
  selectedStepId: string | null;
  /** Ephemeral request used by indirect selection paths that must reveal the selected card. */
  stepPanRequest: StepPanRequest | null;
  /** Per-step expansion; `true` = that card shows files, symbols, and I/O. */
  expandedStepIds: Record<string, true>;
  /** Browser-local visual state, isolated by workflow id. */
  canvasLayouts: Record<string, WorkflowCanvasLayout>;
  /** Non-persisted signal for the mounted canvas to restore its generated node positions. */
  layoutResetRevision: number;
  searchQuery: string;
  searchOpen: boolean;
  diagnosticsOpen: boolean;
  theme: Theme;
}

interface CodeHQUiActions {
  selectWorkflow: (workflowId: string | null) => void;
  selectStep: (stepId: string | null) => void;
  selectStepAndPan: (workflowId: string, stepId: string) => void;
  toggleStepExpanded: (workflowId: string, stepId: string) => void;
  collapseAllSteps: (workflowId: string) => void;
  saveNodePosition: (workflowId: string, nodeId: string, position: CanvasPoint) => void;
  saveEdgeBend: (workflowId: string, edgeId: string, bend: CanvasBend) => void;
  saveCanvasViewport: (workflowId: string, viewport: CanvasViewport) => void;
  reconcileCanvasLayout: (workflowId: string, nodeIds: ReadonlySet<string>, edgeIds: ReadonlySet<string>) => void;
  resetLayout: (workflowId?: string) => void;
  setSearchQuery: (query: string) => void;
  openSearch: () => void;
  closeSearch: () => void;
  toggleDiagnostics: () => void;
  closeDiagnostics: () => void;
  setTheme: (theme: Theme) => void;
}

export type CodeHQStore = CodeHQUiState & CodeHQUiActions;

const STORAGE_KEY = "codehq.ui";
const LIGHT_THEME_QUERY = "(prefers-color-scheme: light)";

function getInitialTheme(): Theme {
  try {
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      return window.matchMedia(LIGHT_THEME_QUERY).matches ? "light" : "dark";
    }
  } catch {
    // Browser policy and incomplete test environments can make matchMedia unavailable.
  }
  return "dark";
}

/**
 * Wraps `window.localStorage` so a failure (quota exceeded, private browsing, storage
 * disabled by policy) can never crash the app — persistence is a convenience, not a
 * requirement, so every failure is swallowed after being reduced to a no-op.
 */
const safeStorage: StateStorage = {
  getItem: (name) => {
    try {
      return window.localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      window.localStorage.setItem(name, value);
    } catch {
      // Storage unavailable or full: this write is simply not persisted this session.
    }
  },
  removeItem: (name) => {
    try {
      window.localStorage.removeItem(name);
    } catch {
      // Nothing to clean up if storage never accepted writes in the first place.
    }
  },
};

const INITIAL_STATE: CodeHQUiState = {
  selectedWorkflowId: null,
  selectedStepId: null,
  stepPanRequest: null,
  expandedStepIds: {},
  canvasLayouts: {},
  layoutResetRevision: 0,
  searchQuery: "",
  searchOpen: false,
  diagnosticsOpen: false,
  theme: getInitialTheme(),
};

export const useCodeHQStore = create<CodeHQStore>()(
  persist(
    (set) => ({
      ...INITIAL_STATE,

      selectWorkflow: (workflowId) =>
        set((state) => ({
          selectedWorkflowId: workflowId,
          selectedStepId: null,
          stepPanRequest: null,
          expandedStepIds: workflowId === null ? {} : state.canvasLayouts[workflowId]?.expandedStepIds ?? {},
        })),

      // The diagnostics panel and the step drawer are both single-focus overlays (contract §11
      // accessibility: focus traps must never nest) — selecting a step always closes
      // diagnostics, and opening diagnostics always clears the selected step, so exactly one of
      // the two can be on screen at a time.
      selectStep: (stepId) =>
        set((state) => ({
          selectedStepId: stepId,
          stepPanRequest: null,
          diagnosticsOpen: stepId !== null ? false : state.diagnosticsOpen,
        })),

      selectStepAndPan: (workflowId, stepId) =>
        set({
          selectedStepId: stepId,
          stepPanRequest: { workflowId, stepId },
          diagnosticsOpen: false,
        }),

      toggleStepExpanded: (workflowId, stepId) =>
        set((state) => {
          const layout = state.canvasLayouts[workflowId] ?? { nodePositions: {}, edgeBends: {}, expandedStepIds: {} };
          const next = { ...layout.expandedStepIds };
          if (next[stepId]) {
            delete next[stepId];
          } else {
            next[stepId] = true;
          }
          return {
            expandedStepIds: next,
            canvasLayouts: { ...state.canvasLayouts, [workflowId]: { ...layout, expandedStepIds: next } },
          };
        }),

      collapseAllSteps: (workflowId) => set((state) => {
        const layout = state.canvasLayouts[workflowId] ?? { nodePositions: {}, edgeBends: {}, expandedStepIds: {} };
        return {
          expandedStepIds: {},
          canvasLayouts: { ...state.canvasLayouts, [workflowId]: { ...layout, expandedStepIds: {} } },
        };
      }),

      saveNodePosition: (workflowId, nodeId, position) => set((state) => {
        const layout = state.canvasLayouts[workflowId] ?? { nodePositions: {}, edgeBends: {}, expandedStepIds: {} };
        return {
          canvasLayouts: {
            ...state.canvasLayouts,
            [workflowId]: { ...layout, nodePositions: { ...layout.nodePositions, [nodeId]: position } },
          },
        };
      }),

      saveEdgeBend: (workflowId, edgeId, bend) => set((state) => {
        const layout = state.canvasLayouts[workflowId] ?? { nodePositions: {}, edgeBends: {}, expandedStepIds: {} };
        return {
          canvasLayouts: {
            ...state.canvasLayouts,
            [workflowId]: { ...layout, edgeBends: { ...layout.edgeBends, [edgeId]: bend } },
          },
        };
      }),

      saveCanvasViewport: (workflowId, viewport) => set((state) => {
        const layout = state.canvasLayouts[workflowId] ?? { nodePositions: {}, edgeBends: {}, expandedStepIds: {} };
        return { canvasLayouts: { ...state.canvasLayouts, [workflowId]: { ...layout, viewport } } };
      }),

      reconcileCanvasLayout: (workflowId, nodeIds, edgeIds) => set((state) => {
        const layout = state.canvasLayouts[workflowId];
        if (layout === undefined) {
          return state;
        }
        const nodePositions = Object.fromEntries(Object.entries(layout.nodePositions).filter(([id]) => nodeIds.has(id)));
        const edgeBends = Object.fromEntries(Object.entries(layout.edgeBends).filter(([id]) => edgeIds.has(id)));
        const expandedStepIds = Object.fromEntries(Object.entries(layout.expandedStepIds).filter(([id]) => nodeIds.has(id))) as Record<string, true>;
        if (
          Object.keys(nodePositions).length === Object.keys(layout.nodePositions).length
          && Object.keys(edgeBends).length === Object.keys(layout.edgeBends).length
          && Object.keys(expandedStepIds).length === Object.keys(layout.expandedStepIds).length
        ) {
          return state;
        }
        return {
          expandedStepIds,
          canvasLayouts: {
            ...state.canvasLayouts,
            [workflowId]: { ...layout, nodePositions, edgeBends, expandedStepIds },
          },
        };
      }),

      resetLayout: (requestedWorkflowId) => set((state) => {
        const workflowId = requestedWorkflowId ?? state.selectedWorkflowId;
        if (workflowId === null) {
          return state;
        }
        const canvasLayouts = { ...state.canvasLayouts };
        delete canvasLayouts[workflowId];
        return { canvasLayouts, expandedStepIds: {}, layoutResetRevision: state.layoutResetRevision + 1 };
      }),

      setSearchQuery: (searchQuery) => set({ searchQuery }),

      openSearch: () => set({ searchOpen: true }),

      closeSearch: () => set({ searchOpen: false }),

      toggleDiagnostics: () =>
        set((state) => {
          const diagnosticsOpen = !state.diagnosticsOpen;
          return { diagnosticsOpen, selectedStepId: diagnosticsOpen ? null : state.selectedStepId };
        }),

      closeDiagnostics: () => set({ diagnosticsOpen: false }),

      setTheme: (theme) => set({ theme }),
    }),
    {
      name: STORAGE_KEY,
      version: PERSIST_VERSION,
      storage: createJSONStorage(() => safeStorage),
      partialize: (state) => ({ theme: state.theme, canvasLayouts: state.canvasLayouts }),
      /**
       * v0/v1 stored a canvas depth preference. The board is story-only now, so drop it.
       */
      migrate: (persisted) => {
        if (persisted === undefined || persisted === null || typeof persisted !== "object") {
          return persisted as CodeHQUiState;
        }
        const state = { ...(persisted as Record<string, unknown>) };
        delete state.depth;
        return state as unknown as CodeHQUiState;
      },
    },
  ),
);

/** Test-only helper (and handy for "reset" affordances) to restore the initial UI state. */
export function resetCodeHQStore(): void {
  useCodeHQStore.setState({ ...INITIAL_STATE });
}
