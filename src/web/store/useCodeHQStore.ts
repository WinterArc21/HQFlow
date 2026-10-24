import { findScene } from "../design/scenes";
import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import type {
  CanvasBend,
  CanvasPoint,
  WorkflowCanvasLayout,
} from "@schema/wire";

export type { CanvasBend, CanvasBendSnap, CanvasPoint, WorkflowCanvasLayout } from "@schema/wire";

/**
 * UI state only (contract §11) — workflow/step/project data always comes from the server
 * snapshot (see `api/events.ts`) and never lives here.
 */

export type Theme = "dark" | "light";
/** Ambient motion: `full` animates scenes and edges, `calm` slows them, `still` freezes them. */
export type MotionLevel = "full" | "calm" | "still";

export interface StepPanRequest {
  workflowId: string;
  stepId: string;
}

/** Persist schema version — bump when migrating stored UI preferences. */
const PERSIST_VERSION = 7;

interface CodeHQUiState {
  selectedWorkflowId: string | null;
  selectedStepId: string | null;
  /** Ephemeral request used by indirect selection paths that must reveal the selected card. */
  stepPanRequest: StepPanRequest | null;
  /** Whether the selected step shows its full side panel instead of the in-place step card. */
  stepDetailFull: boolean;
  /** Per-step expansion; `true` = that card shows files, symbols, and I/O. */
  expandedStepIds: Record<string, true>;
  /** In-memory visual state loaded from the active repository's local server. */
  canvasLayouts: Record<string, WorkflowCanvasLayout>;
  /** Non-persisted signal for the mounted canvas to restore its generated node positions. */
  layoutResetRevision: number;
  searchQuery: string;
  searchOpen: boolean;
  diagnosticsOpen: boolean;
  theme: Theme;
  /** The scene shown in each theme family; the theme toggle swaps between the two. */
  darkScene: string;
  lightScene: string;
  motion: MotionLevel;
  appearanceOpen: boolean;
}

interface CodeHQUiActions {
  selectWorkflow: (workflowId: string | null) => void;
  selectStep: (stepId: string | null) => void;
  selectStepAndPan: (workflowId: string, stepId: string) => void;
  openStepDetailFull: () => void;
  toggleStepExpanded: (stepId: string) => void;
  collapseAllSteps: () => void;
  saveNodePosition: (workflowId: string, nodeId: string, position: CanvasPoint) => void;
  saveEdgeBend: (workflowId: string, edgeId: string, bend: CanvasBend) => void;
  hydrateCanvasLayout: (workflowId: string, layout: WorkflowCanvasLayout | null) => void;
  reconcileCanvasLayout: (workflowId: string, nodeIds: ReadonlySet<string>, edgeIds: ReadonlySet<string>) => void;
  resetLayout: (workflowId?: string) => void;
  /** Picks a view for one workflow. Dragged positions and bends belong to the old view's
   * geometry, so they are cleared. */
  setCanvasView: (workflowId: string, view: NonNullable<WorkflowCanvasLayout["view"]>) => void;
  setSearchQuery: (query: string) => void;
  openSearch: () => void;
  closeSearch: () => void;
  toggleDiagnostics: () => void;
  closeDiagnostics: () => void;
  setTheme: (theme: Theme) => void;
  /** Shows a scene: switches to its theme family and remembers it for that family. */
  setScene: (sceneId: string, base: Theme) => void;
  setMotion: (motion: MotionLevel) => void;
  setAppearanceOpen: (open: boolean) => void;
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
 * Wraps `window.localStorage` so a theme-preference write failure (quota exceeded, private
 * browsing, storage disabled by policy) can never crash the app.
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
  stepDetailFull: false,
  expandedStepIds: {},
  canvasLayouts: {},
  layoutResetRevision: 0,
  searchQuery: "",
  searchOpen: false,
  diagnosticsOpen: false,
  theme: getInitialTheme(),
  darkScene: "abyss-mesh",
  lightScene: "sorbet",
  motion: "full",
  appearanceOpen: false,
};

export const useCodeHQStore = create<CodeHQStore>()(
  persist(
    (set) => ({
      ...INITIAL_STATE,

      selectWorkflow: (workflowId) =>
        set({
          selectedWorkflowId: workflowId,
          selectedStepId: null,
          stepPanRequest: null,
          stepDetailFull: false,
          expandedStepIds: {},
        }),

      // The diagnostics panel and the step drawer are both single-focus overlays (contract §11
      // accessibility: focus traps must never nest) — selecting a step always closes
      // diagnostics, and opening diagnostics always clears the selected step, so exactly one of
      // the two can be on screen at a time.
      selectStep: (stepId) =>
        set((state) => ({
          selectedStepId: stepId,
          stepPanRequest: null,
          stepDetailFull: false,
          diagnosticsOpen: stepId !== null ? false : state.diagnosticsOpen,
        })),

      selectStepAndPan: (workflowId, stepId) =>
        set({
          selectedStepId: stepId,
          stepPanRequest: { workflowId, stepId },
          stepDetailFull: false,
          diagnosticsOpen: false,
        }),

      openStepDetailFull: () => set({ stepDetailFull: true }),

      toggleStepExpanded: (stepId) =>
        set((state) => {
          const next = { ...state.expandedStepIds };
          if (next[stepId]) {
            delete next[stepId];
          } else {
            next[stepId] = true;
          }
          return { expandedStepIds: next };
        }),

      collapseAllSteps: () => set({ expandedStepIds: {} }),

      saveNodePosition: (workflowId, nodeId, position) => set((state) => {
        const layout = state.canvasLayouts[workflowId] ?? { nodePositions: {}, edgeBends: {} };
        return {
          canvasLayouts: {
            ...state.canvasLayouts,
            [workflowId]: { ...layout, nodePositions: { ...layout.nodePositions, [nodeId]: position } },
          },
        };
      }),

      saveEdgeBend: (workflowId, edgeId, bend) => set((state) => {
        const layout = state.canvasLayouts[workflowId] ?? { nodePositions: {}, edgeBends: {} };
        return {
          canvasLayouts: {
            ...state.canvasLayouts,
            [workflowId]: { ...layout, edgeBends: { ...layout.edgeBends, [edgeId]: bend } },
          },
        };
      }),

      hydrateCanvasLayout: (workflowId, layout) => set((state) => {
        const canvasLayouts = { ...state.canvasLayouts };
        if (layout === null) {
          delete canvasLayouts[workflowId];
        } else {
          canvasLayouts[workflowId] = layout;
        }
        return { canvasLayouts };
      }),

      reconcileCanvasLayout: (workflowId, nodeIds, edgeIds) => set((state) => {
        const expandedStepIds = Object.fromEntries(
          Object.entries(state.expandedStepIds).filter(([id]) => nodeIds.has(id)),
        ) as Record<string, true>;
        const layout = state.canvasLayouts[workflowId];
        if (layout === undefined) {
          return Object.keys(expandedStepIds).length === Object.keys(state.expandedStepIds).length
            ? state
            : { expandedStepIds };
        }
        const nodePositions = Object.fromEntries(Object.entries(layout.nodePositions).filter(([id]) => nodeIds.has(id)));
        const edgeBends = Object.fromEntries(Object.entries(layout.edgeBends).filter(([id]) => edgeIds.has(id)));
        if (
          Object.keys(nodePositions).length === Object.keys(layout.nodePositions).length
          && Object.keys(edgeBends).length === Object.keys(layout.edgeBends).length
          && Object.keys(expandedStepIds).length === Object.keys(state.expandedStepIds).length
        ) {
          return state;
        }
        return {
          expandedStepIds,
          canvasLayouts: {
            ...state.canvasLayouts,
            [workflowId]: { ...layout, nodePositions, edgeBends },
          },
        };
      }),

      resetLayout: (requestedWorkflowId) => set((state) => {
        const workflowId = requestedWorkflowId ?? state.selectedWorkflowId;
        if (workflowId === null) {
          return state;
        }
        const canvasLayouts = { ...state.canvasLayouts };
        // Reset clears what the user dragged; the view they picked stays.
        const view = canvasLayouts[workflowId]?.view;
        if (view === undefined) {
          delete canvasLayouts[workflowId];
        } else {
          canvasLayouts[workflowId] = { nodePositions: {}, edgeBends: {}, view };
        }
        return { canvasLayouts, expandedStepIds: {}, layoutResetRevision: state.layoutResetRevision + 1 };
      }),

      setCanvasView: (workflowId, view) => set((state) => ({
        canvasLayouts: { ...state.canvasLayouts, [workflowId]: { nodePositions: {}, edgeBends: {}, view } },
      })),

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

      setScene: (sceneId, base) => set(findScene(sceneId)?.base === "both" ? { theme: base, darkScene: sceneId, lightScene: sceneId } : base === "dark" ? { theme: base, darkScene: sceneId } : { theme: base, lightScene: sceneId }),

      setMotion: (motion) => set({ motion }),

      setAppearanceOpen: (appearanceOpen) => set({ appearanceOpen }),
    }),
    {
      name: STORAGE_KEY,
      version: PERSIST_VERSION,
      storage: createJSONStorage(() => safeStorage),
      partialize: (state) => ({
        theme: state.theme,
        darkScene: state.darkScene,
        lightScene: state.lightScene,
        motion: state.motion,
      }),
      /**
       * v0/v1 stored a canvas depth preference. The board is story-only now, so drop it.
       * v5 added appearance fields; older states simply take their defaults from the initial state.
       * v6 dropped the per-scene card colour overrides: each scene now owns its card colours.
       * v7 dropped the grid and card-surface overrides: each scene owns those too.
       */
      migrate: (persisted) => {
        if (persisted === undefined || persisted === null || typeof persisted !== "object") {
          return persisted as CodeHQUiState;
        }
        const state = { ...(persisted as Record<string, unknown>) };
        delete state.depth;
        delete state.canvasLayouts;
        delete state.categoryColors;
        delete state.gridMode;
        delete state.cardSurface;
        return state as unknown as CodeHQUiState;
      },
    },
  ),
);

/** Test-only helper (and handy for "reset" affordances) to restore the initial UI state. */
export function resetCodeHQStore(): void {
  useCodeHQStore.setState({ ...INITIAL_STATE });
}
