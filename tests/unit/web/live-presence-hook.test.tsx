import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Workflow, WorkflowStep } from "@schema/workflow";
import { useLivePresence } from "@web/components/canvas/useLivePresence";
import type { PresenceDriver } from "@web/components/canvas/livePresence";

function makeStep(id: string, overrides: Partial<WorkflowStep> = {}): WorkflowStep {
  return { id, name: `Step ${id}`, purpose: `Purpose of ${id}.`, ...overrides };
}

function makeWorkflow(steps: string[], id = "wf"): Workflow {
  return {
    schemaVersion: "0.1",
    id,
    name: "Workflow",
    purpose: "A test workflow.",
    steps: steps.map((stepId) => makeStep(stepId)),
    connections: [],
  };
}

const hangingDriver: PresenceDriver = {
  sleep(_ms, signal) {
    return new Promise((_resolve, reject) => {
      const fail = (): void => reject(new DOMException("Aborted", "AbortError"));
      if (signal.aborted) {
        fail();
        return;
      }
      signal.addEventListener("abort", fail, { once: true });
    });
  },
  async animateCursor() {},
};

describe("useLivePresence", () => {
  it("flushes additions immediately in export or reduced-motion mode", () => {
    const container = { current: document.createElement("div") };
    const first = makeWorkflow(["a"]);
    const { result, rerender } = renderHook(
      ({ workflow, flush }) => useLivePresence({ workflow, flush, containerRef: container }),
      { initialProps: { workflow: first, flush: false } },
    );

    rerender({ workflow: makeWorkflow(["a", "b"]), flush: false });
    expect([...result.current.view.pendingNodeIds]).toEqual(["b"]);

    rerender({ workflow: makeWorkflow(["a", "b"]), flush: true });
    expect([...result.current.view.pendingNodeIds]).toEqual([]);
    expect(result.current.view.cursor).toBeNull();
  });

  it("shows a switched workflow immediately and aborts the previous session", async () => {
    const container = { current: document.createElement("div") };
    const { result, rerender, unmount } = renderHook(
      ({ workflow, flush }) => useLivePresence({
        workflow,
        flush,
        containerRef: container,
        driver: hangingDriver,
      }),
      { initialProps: { workflow: makeWorkflow(["a"]), flush: false } },
    );

    rerender({ workflow: makeWorkflow(["a", "b"]), flush: false });
    expect([...result.current.view.pendingNodeIds]).toEqual(["b"]);

    rerender({ workflow: makeWorkflow(["x", "y"], "other"), flush: false });
    expect([...result.current.view.pendingNodeIds]).toEqual([]);
    expect(result.current.view.cursor).toBeNull();
    unmount();
  });
});
