import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetCodeHQStore, useCodeHQStore } from "@web/store/useCodeHQStore";

const STORAGE_KEY = "codehq.ui";

function setSystemTheme(theme: "dark" | "light"): void {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query) =>
      ({
        matches: query === "(prefers-color-scheme: light)" && theme === "light",
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
}

async function loadFreshStore() {
  vi.resetModules();
  return import("@web/store/useCodeHQStore");
}

beforeEach(() => {
  vi.restoreAllMocks();
  resetCodeHQStore();
  window.localStorage.clear();
});

describe("useCodeHQStore", () => {
  it.each(["light", "dark"] as const)("uses the system %s theme on first use", async (theme) => {
    setSystemTheme(theme);

    const { useCodeHQStore: freshStore } = await loadFreshStore();

    expect(freshStore.getState().theme).toBe(theme);
  });

  it("uses a persisted explicit theme instead of the system theme", async () => {
    setSystemTheme("dark");
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ state: { theme: "light" }, version: 2 }),
    );

    const { useCodeHQStore: freshStore } = await loadFreshStore();

    expect(freshStore.getState().theme).toBe("light");
  });

  it("requests a pan only for indirect step selection", () => {
    useCodeHQStore.getState().selectStepAndPan("workflow-a", "step-2");

    expect(useCodeHQStore.getState().selectedStepId).toBe("step-2");
    expect(useCodeHQStore.getState().stepPanRequest).toEqual({ workflowId: "workflow-a", stepId: "step-2" });

    useCodeHQStore.getState().selectStep("step-1");
    expect(useCodeHQStore.getState().stepPanRequest).toBeNull();
  });

  it("keeps canvas state in memory while persisting only appearance preferences", () => {
    useCodeHQStore.getState().setTheme("light");
    useCodeHQStore.getState().saveNodePosition("workflow-a", "step-1", { x: 12, y: 34 });
    useCodeHQStore.getState().saveEdgeBend("workflow-a", "edge-1", { point: { x: 56, y: 78 }, snap: null });

    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed: { version: number; state: Record<string, unknown> } = JSON.parse(raw as string);

    expect(parsed.version).toBe(8);
    expect(parsed.state.theme).toBe("light");
    expect(useCodeHQStore.getState().canvasLayouts).toEqual({
      "workflow-a": {
        nodePositions: { "step-1": { x: 12, y: 34 } },
        edgeBends: { "edge-1": { point: { x: 56, y: 78 }, snap: null } },
      },
    });
    expect(Object.keys(parsed.state).sort()).toEqual(
      ["darkScene", "lightScene", "motion", "theme"],
    );
  });

  it("hydrates repository-local canvas state for the selected workflow", () => {
    useCodeHQStore.getState().selectWorkflow("workflow-a");
    useCodeHQStore.getState().hydrateCanvasLayout("workflow-a", {
      nodePositions: { "step-1": { x: 12, y: 34 } },
      edgeBends: {},
    });

    expect(useCodeHQStore.getState().canvasLayouts["workflow-a"]?.nodePositions).toEqual({
      "step-1": { x: 12, y: 34 },
    });
  });

  it("prunes visual state for removed nodes and edges without touching known entries", () => {
    useCodeHQStore.getState().saveNodePosition("workflow-a", "known", { x: 1, y: 2 });
    useCodeHQStore.getState().saveNodePosition("workflow-a", "removed", { x: 3, y: 4 });
    useCodeHQStore.getState().saveEdgeBend("workflow-a", "known-edge", { point: { x: 5, y: 6 }, snap: "source-x" });
    useCodeHQStore.getState().saveEdgeBend("workflow-a", "removed-edge", { point: { x: 7, y: 8 }, snap: null });

    useCodeHQStore.getState().reconcileCanvasLayout(
      "workflow-a",
      new Set(["known"]),
      new Set(["known-edge"]),
    );

    expect(useCodeHQStore.getState().canvasLayouts["workflow-a"]).toMatchObject({
      nodePositions: { known: { x: 1, y: 2 } },
      edgeBends: { "known-edge": { point: { x: 5, y: 6 }, snap: "source-x" } },
    });
  });

  it("does not throw when localStorage.setItem fails (quota exceeded, private mode, etc.)", () => {
    const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
    window.localStorage.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    try {
      expect(() => useCodeHQStore.getState().setTheme("dark")).not.toThrow();
    } finally {
      window.localStorage.setItem = originalSetItem;
    }
  });

  it("does not throw when localStorage.getItem fails", () => {
    const originalGetItem = window.localStorage.getItem.bind(window.localStorage);
    window.localStorage.getItem = () => {
      throw new Error("SecurityError");
    };
    try {
      expect(() => useCodeHQStore.getState().setTheme("light")).not.toThrow();
    } finally {
      window.localStorage.getItem = originalGetItem;
    }
  });

  it("restores dragged positions and bends when switching back to a view", () => {
    const store = useCodeHQStore.getState();
    store.saveNodePosition("wf", "a", { x: 10, y: 20 });
    store.saveEdgeBend("wf", "e", { point: { x: 1, y: 2 }, snap: null });
    store.setCanvasView("wf", "wrap", "flow");
    expect(useCodeHQStore.getState().canvasLayouts.wf?.nodePositions).toEqual({});
    store.saveNodePosition("wf", "a", { x: 99, y: 99 });
    store.setCanvasView("wf", "flow", "wrap");
    const layout = useCodeHQStore.getState().canvasLayouts.wf;
    expect(layout?.nodePositions).toEqual({ a: { x: 10, y: 20 } });
    expect(layout?.edgeBends).toEqual({ e: { point: { x: 1, y: 2 }, snap: null } });
    expect(layout?.otherViews?.wrap?.nodePositions).toEqual({ a: { x: 99, y: 99 } });

    store.resetLayout("wf");
    const reset = useCodeHQStore.getState().canvasLayouts.wf;
    expect(reset?.nodePositions).toEqual({});
    expect(reset?.otherViews?.wrap?.nodePositions).toEqual({ a: { x: 99, y: 99 } });
  });

  it("drops the removed card size preference while keeping other appearance settings", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ state: { theme: "light", motion: "calm", cardSize: "wide" }, version: 7 }),
    );
    const { useCodeHQStore: freshStore } = await loadFreshStore();
    expect(freshStore.getState()).toMatchObject({ theme: "light", motion: "calm" });
    expect(freshStore.getState()).not.toHaveProperty("cardSize");
  });

});
