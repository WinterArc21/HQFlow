import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Workflow } from "@schema/workflow";
import { CanvasHeader, type CanvasHeaderProps } from "@web/components/canvas/CanvasHeader";

const WORKFLOW: Workflow = {
  schemaVersion: "0.1",
  id: "checkout",
  name: "Checkout",
  purpose: "Captures payment for a cart.",
  steps: [{ id: "charge", name: "Charge", purpose: "Captures payment." }],
  connections: [],
};

const TOOLBAR_PROPS: Omit<CanvasHeaderProps, "workflow"> = {
  onZoomIn: () => {},
  onZoomOut: () => {},
  onResetLayout: () => {},
  onCollapseAll: () => {},
  collapseDisabled: true,
};

afterEach(() => {
  vi.useRealTimers();
});

describe("CanvasHeader workflow trust context", () => {
  it("shows stale state and relative modification time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T12:00:00.000Z"));

    render(
      <CanvasHeader
        workflow={WORKFLOW}
        modifiedAt="2026-08-10T09:00:00.000Z"
        state="stale"
        {...TOOLBAR_PROPS}
      />,
    );

    const trust = screen.getByLabelText("Workflow freshness");
    expect(within(trust).getByText("Stale")).toBeInTheDocument();
    expect(within(trust).getByText("Updated 3h ago")).toBeInTheDocument();
  });

  it("omits freshness metadata when it is unavailable", () => {
    render(<CanvasHeader workflow={WORKFLOW} {...TOOLBAR_PROPS} />);

    const trust = screen.getByLabelText("Workflow freshness");
    expect(within(trust).queryByText("Stale")).not.toBeInTheDocument();
    expect(within(trust).queryByText(/^Updated /)).not.toBeInTheDocument();
  });

  it("offers reset layout beside the zoom controls", () => {
    const onResetLayout = vi.fn();
    render(<CanvasHeader workflow={WORKFLOW} {...TOOLBAR_PROPS} onResetLayout={onResetLayout} />);

    fireEvent.click(screen.getByRole("button", { name: "Reset layout" }));

    expect(onResetLayout).toHaveBeenCalledOnce();
  });
});
