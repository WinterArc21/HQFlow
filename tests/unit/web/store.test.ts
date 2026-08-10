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
      JSON.stringify({ state: { theme: "light", depth: "workflow" }, version: 1 }),
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

  it("selecting a workflow clears step selection and expansion", () => {
    useCodeHQStore.getState().selectStep("step-1");
    useCodeHQStore.getState().toggleStepExpanded("step-1");
    expect(useCodeHQStore.getState().selectedStepId).toBe("step-1");
    expect(useCodeHQStore.getState().expandedStepIds).toEqual({ "step-1": true });

    useCodeHQStore.getState().selectWorkflow("workflow-a");

    expect(useCodeHQStore.getState().selectedWorkflowId).toBe("workflow-a");
    expect(useCodeHQStore.getState().selectedStepId).toBeNull();
    expect(useCodeHQStore.getState().expandedStepIds).toEqual({});
  });

  it("toggleStepExpanded toggles a single step id on and off", () => {
    useCodeHQStore.getState().toggleStepExpanded("a");
    expect(useCodeHQStore.getState().expandedStepIds).toEqual({ a: true });

    useCodeHQStore.getState().toggleStepExpanded("a");
    expect(useCodeHQStore.getState().expandedStepIds).toEqual({});
  });

  it("collapseAllSteps clears every expanded step", () => {
    useCodeHQStore.getState().toggleStepExpanded("a");
    useCodeHQStore.getState().toggleStepExpanded("b");
    useCodeHQStore.getState().collapseAllSteps();
    expect(useCodeHQStore.getState().expandedStepIds).toEqual({});
  });

  it("signals a layout reset without changing workflow or step selection", () => {
    useCodeHQStore.getState().selectWorkflow("workflow-a");
    useCodeHQStore.getState().selectStep("step-1");

    useCodeHQStore.getState().resetLayout();

    expect(useCodeHQStore.getState().layoutResetRevision).toBe(1);
    expect(useCodeHQStore.getState().selectedWorkflowId).toBe("workflow-a");
    expect(useCodeHQStore.getState().selectedStepId).toBe("step-1");
  });

  it("persists only theme and depth, under one namespaced localStorage key", () => {
    useCodeHQStore.getState().setTheme("light");
    useCodeHQStore.getState().setDepth("modules");
    useCodeHQStore.getState().selectWorkflow("some-workflow");

    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed: { state: Record<string, unknown> } = JSON.parse(raw as string);

    expect(parsed.state.theme).toBe("light");
    expect(parsed.state.depth).toBe("modules");
    expect(Object.keys(parsed.state).sort()).toEqual(["depth", "theme"]);
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
      expect(() => useCodeHQStore.getState().setDepth("modules")).not.toThrow();
    } finally {
      window.localStorage.getItem = originalGetItem;
    }
  });
});
