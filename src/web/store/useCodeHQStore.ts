import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

/**
 * UI state only (contract §11) — workflow/step/project data always comes from the server
 * snapshot (see `api/events.ts`) and never lives here.
 */

export type Theme = "dark" | "light";
export type CanvasBackground = "grid" | "mist" | "blueprint" | "plain";

export interface StepPanRequest {
  workflowId: string;
  stepId: string;
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
  /** Non-persisted signal for the mounted canvas to restore its generated node positions. */
  layoutResetRevision: number;
  searchQuery: string;
  searchOpen: boolean;
  diagnosticsOpen: boolean;
  theme: Theme;
  canvasBackground: CanvasBackground;
}

interface CodeHQUiActions {
  selectWorkflow: (workflowId: string | null) => void;
  selectStep: (stepId: string | null) => void;
  selectStepAndPan: (workflowId: string, stepId: string) => void;
  toggleStepExpanded: (stepId: string) => void;
  collapseAllSteps: () => void;
  resetLayout: () => void;
  setSearchQuery: (query: string) => void;
  openSearch: () => void;
  closeSearch: () => void;
  toggleDiagnostics: () => void;
  closeDiagnostics: () => void;
  setTheme: (theme: Theme) => void;
  setCanvasBackground: (background: CanvasBackground) => void;
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
  layoutResetRevision: 0,
  searchQuery: "",
  searchOpen: false,
  diagnosticsOpen: false,
  theme: getInitialTheme(),
  canvasBackground: "grid",
};

export const useCodeHQStore = create<CodeHQStore>()(
  persist(
    (set) => ({
      ...INITIAL_STATE,

      selectWorkflow: (workflowId) =>
        set({ selectedWorkflowId: workflowId, selectedStepId: null, stepPanRequest: null, expandedStepIds: {} }),

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

      resetLayout: () => set((state) => ({ layoutResetRevision: state.layoutResetRevision + 1 })),

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
      setCanvasBackground: (canvasBackground) => set({ canvasBackground }),
    }),
    {
      name: STORAGE_KEY,
      version: PERSIST_VERSION,
      storage: createJSONStorage(() => safeStorage),
      partialize: (state) => ({ theme: state.theme, canvasBackground: state.canvasBackground }),
      /**
       * v0/v1 stored a canvas depth preference. The board is story-only now, so drop it.
       */
      migrate: (persisted) => {
        if (persisted === undefined || persisted === null || typeof persisted !== "object") {
          return persisted as CodeHQUiState;
        }
        const state = { ...(persisted as Record<string, unknown>) };
        delete state.depth;
        if (state.canvasBackground !== undefined
          && state.canvasBackground !== "grid"
          && state.canvasBackground !== "mist"
          && state.canvasBackground !== "blueprint"
          && state.canvasBackground !== "plain") {
          delete state.canvasBackground;
        }
        return state as unknown as CodeHQUiState;
      },
    },
  ),
);

/** Test-only helper (and handy for "reset" affordances) to restore the initial UI state. */
export function resetCodeHQStore(): void {
  useCodeHQStore.setState({ ...INITIAL_STATE });
}
