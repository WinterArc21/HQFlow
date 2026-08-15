import "@testing-library/jest-dom/vitest";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Workflow } from "@schema/workflow";
import { WorkflowCanvas } from "@web/components/canvas";
import { useCanvasKeyboardNav } from "@web/components/canvas/useCanvasKeyboardNav";
import { resetCodeHQStore, useCodeHQStore } from "@web/store/useCodeHQStore";

const WORKFLOW: Workflow = {
  schemaVersion: "0.1",
  id: "checkout",
  name: "Checkout",
  purpose: "Captures payment for a cart.",
  steps: [
    { id: "receive", name: "Receive Request", purpose: "Accepts the checkout payload." },
    { id: "validate", name: "Validate Cart", purpose: "Confirms the cart is still valid." },
    { id: "charge", name: "Charge Card", purpose: "Captures the payment." },
    { id: "confirm", name: "Send Confirmation", purpose: "Emails the receipt.", category: "output" },
    { id: "declined", name: "Payment Declined", purpose: "Ends checkout without charging.", category: "output" },
  ],
  connections: [
    { from: "receive", to: "validate" },
    { from: "validate", to: "charge" },
    { from: "charge", to: "confirm" },
    { from: "charge", to: "declined", type: "failure" },
  ],
};

afterEach(() => {
  resetCodeHQStore();
});

/**
 * The canvas frame now has a real, focusable header (zoom, fit, collapse-all —
 * contract §10.4) sitting before the graph in DOM/tab order, so reaching the first step node no
 * longer takes exactly one Tab press. Presses Tab until a `[data-step-node]` element is focused,
 * capped well above the toolbar's control count so a real regression still fails loudly instead
 * of hanging.
 */
async function tabToFirstStepNode(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await user.tab();
    if ((document.activeElement as HTMLElement | null)?.dataset.stepNode !== undefined) {
      return;
    }
  }
}

describe("WorkflowCanvas keyboard navigation", () => {
  it("centers a requested node in the canvas area left visible by the drawer", () => {
    const setCenter = vi.fn();
    const { result } = renderHook(() => useCanvasKeyboardNav({
      workflow: WORKFLOW,
      layoutNodes: [{ id: "validate", x: 100, y: 20, width: 200, height: 160, index: 1, isOutcome: false }],
      containerRef: { current: null },
      reactFlowInstance: { setCenter, getZoom: () => 2 },
      selectedStepId: null,
      onSelect: vi.fn(),
      onClear: vi.fn(),
      reducedMotion: false,
    }));

    act(() => result.current.panToNode("validate", 420));

    expect(setCenter).toHaveBeenCalledWith(305, 100, { zoom: 2, duration: 300 });
  });

  it("is reachable by Tab and exposes an accessible name", async () => {
    render(<WorkflowCanvas workflow={WORKFLOW} sourceChecks={{}} />);
    expect(await screen.findByRole("application", { name: /checkout workflow canvas/i })).toBeInTheDocument();

    const user = userEvent.setup();
    await tabToFirstStepNode(user);
    await waitFor(() => {
      expect(document.querySelector('[data-step-node="receive"]')).toHaveFocus();
    });
  });

  it("moves along the narrative with Down and Up", async () => {
    render(<WorkflowCanvas workflow={WORKFLOW} sourceChecks={{}} />);
    const user = userEvent.setup();

    await tabToFirstStepNode(user);
    await waitFor(() => expect(document.querySelector('[data-step-node="receive"]')).toHaveFocus());

    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(document.querySelector('[data-step-node="validate"]')).toHaveFocus());

    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(document.querySelector('[data-step-node="charge"]')).toHaveFocus());

    await user.keyboard("{ArrowUp}");
    await waitFor(() => expect(document.querySelector('[data-step-node="validate"]')).toHaveFocus());
  });

  it("reaches a lateral failure outcome and returns to its narrative source", async () => {
    render(<WorkflowCanvas workflow={WORKFLOW} sourceChecks={{}} />);
    const user = userEvent.setup();

    await tabToFirstStepNode(user);
    await user.keyboard("{ArrowDown}{ArrowDown}");
    await waitFor(() => expect(document.querySelector('[data-step-node="charge"]')).toHaveFocus());

    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(document.querySelector('[data-step-node="declined"]')).toHaveFocus());

    await user.keyboard("{ArrowLeft}");
    await waitFor(() => expect(document.querySelector('[data-step-node="charge"]')).toHaveFocus());
  });

  it("moves to the last step in topological order on End, and back to first on Home", async () => {
    render(<WorkflowCanvas workflow={WORKFLOW} sourceChecks={{}} />);
    const user = userEvent.setup();

    await tabToFirstStepNode(user);
    await waitFor(() => expect(document.querySelector('[data-step-node="receive"]')).toHaveFocus());

    await user.keyboard("{End}");
    await waitFor(() => expect(document.querySelector('[data-step-node="declined"]')).toHaveFocus());

    await user.keyboard("{Home}");
    await waitFor(() => expect(document.querySelector('[data-step-node="receive"]')).toHaveFocus());
  });

  it("selects the focused step in the store on Enter, and clears it on Escape", async () => {
    render(<WorkflowCanvas workflow={WORKFLOW} sourceChecks={{}} />);
    const user = userEvent.setup();

    await tabToFirstStepNode(user);
    await waitFor(() => expect(document.querySelector('[data-step-node="receive"]')).toHaveFocus());

    await user.keyboard("{Enter}");
    await waitFor(() => expect(useCodeHQStore.getState().selectedStepId).toBe("receive"));

    await user.keyboard("{Escape}");
    await waitFor(() => expect(useCodeHQStore.getState().selectedStepId).toBeNull());
  });
});
