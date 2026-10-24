import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiagnosticsReport } from "@schema/diagnostics";
import { DiagnosticsPanel } from "@web/components/diagnostics/DiagnosticsPanel";

const HEALTHY_REPORT: DiagnosticsReport = {
  generatedAt: new Date().toISOString(),
  valid: true,
  issues: [],
};

const UNHEALTHY_REPORT: DiagnosticsReport = {
  generatedAt: new Date().toISOString(),
  valid: false,
  issues: [
    {
      severity: "warning",
      file: ".codehq/workflows/checkout.json",
      path: "steps[2]",
      message: "Step 'confirm' is unreachable from any entry step.",
      hint: "Add a connection into this step, or remove it.",
    },
    {
      severity: "error",
      file: ".codehq/workflows/checkout.json",
      path: "connections[3].to",
      message: "Connection references unknown step id 'ship-order'.",
      hint: "Fix the 'to' field to reference an existing step id.",
    },
    {
      severity: "error",
      file: ".codehq/workflows/generate-video.json",
      message: "Failed to parse JSON: Unexpected end of input.",
      hint: "The file was likely truncated mid-write. Rewrite it in full.",
    },
  ],
};

function DiagnosticsHarness({ diagnostics, onRecheck }: { diagnostics: DiagnosticsReport; onRecheck: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen(true)}>Open diagnostics</button>
      {open ? <DiagnosticsPanel diagnostics={diagnostics} onClose={() => setOpen(false)} onRecheck={onRecheck} /> : null}
    </div>
  );
}

describe("DiagnosticsPanel", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network calls are not expected in this test")));
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("groups issues by file and renders the path, message, and hint of every issue", () => {
    render(<DiagnosticsPanel diagnostics={UNHEALTHY_REPORT} onClose={() => {}} onRecheck={() => Promise.resolve()} />);

    expect(screen.getByText(".codehq/workflows/checkout.json")).toBeInTheDocument();
    expect(screen.getByText(".codehq/workflows/generate-video.json")).toBeInTheDocument();

    expect(screen.getByText("steps[2]")).toBeInTheDocument();
    expect(screen.getByText("Step 'confirm' is unreachable from any entry step.")).toBeInTheDocument();
    expect(screen.getByText("Add a connection into this step, or remove it.")).toBeInTheDocument();

    expect(screen.getByText("connections[3].to")).toBeInTheDocument();
    expect(screen.getByText("Connection references unknown step id 'ship-order'.")).toBeInTheDocument();
    expect(screen.getByText("Fix the 'to' field to reference an existing step id.")).toBeInTheDocument();

    expect(screen.getByText("Failed to parse JSON: Unexpected end of input.")).toBeInTheDocument();
  });

  it("sorts errors before warnings within a file group, and files with errors before files with only warnings", () => {
    render(<DiagnosticsPanel diagnostics={UNHEALTHY_REPORT} onClose={() => {}} onRecheck={() => Promise.resolve()} />);

    const severityLabels = screen.getAllByText(/^(Error|Warning)$/).map((node) => node.textContent);
    // Within checkout.json, the error ("Connection references...") renders before its warning
    // ("Step 'confirm'..."), even though the warning appears first in the source array. The
    // generate-video.json group (error only) follows, since it has no warnings to reorder.
    expect(severityLabels).toEqual(["Error", "Warning", "Error"]);

    const fileHeadings = screen.getAllByText(/\.codehq\/workflows\//).map((node) => node.textContent);
    expect(fileHeadings).toEqual([".codehq/workflows/checkout.json", ".codehq/workflows/generate-video.json"]);
  });

  it("renders a clean empty state, with the last-checked time, when everything is valid", () => {
    render(<DiagnosticsPanel diagnostics={HEALTHY_REPORT} onClose={() => {}} onRecheck={() => Promise.resolve()} />);

    expect(screen.getByText("No problems found.")).toBeInTheDocument();
    expect(screen.getByText(/Last checked/)).toBeInTheDocument();
    expect(screen.queryByText("Error")).not.toBeInTheDocument();
    expect(screen.queryByText("Warning")).not.toBeInTheDocument();
  });

  it("closes on Escape and restores focus to the element that opened it", async () => {
    render(<DiagnosticsHarness diagnostics={UNHEALTHY_REPORT} onRecheck={() => Promise.resolve()} />);
    const user = userEvent.setup();

    const openButton = screen.getByRole("button", { name: "Open diagnostics" });
    openButton.focus();
    await user.click(openButton);

    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(openButton).toHaveFocus();
  });

  it("closes when a click starts and ends on the backdrop", async () => {
    render(<DiagnosticsHarness diagnostics={UNHEALTHY_REPORT} onRecheck={() => Promise.resolve()} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Open diagnostics" }));

    const dialog = screen.getByRole("dialog");
    const backdrop = dialog.parentElement as HTMLElement;
    expect(backdrop).not.toBe(dialog);

    fireEvent.pointerDown(backdrop);
    fireEvent.pointerUp(backdrop);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("does not close when a click lands inside the panel, nor when it starts inside and is released on the backdrop", async () => {
    render(<DiagnosticsHarness diagnostics={UNHEALTHY_REPORT} onRecheck={() => Promise.resolve()} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Open diagnostics" }));

    const dialog = screen.getByRole("dialog");
    const backdrop = dialog.parentElement as HTMLElement;

    fireEvent.pointerDown(dialog);
    fireEvent.pointerUp(dialog);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.pointerDown(dialog);
    fireEvent.pointerUp(backdrop);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("wires 'Recheck files' to the real recheck action", async () => {
    const onRecheck = vi.fn().mockResolvedValue(undefined);
    render(<DiagnosticsPanel diagnostics={UNHEALTHY_REPORT} onClose={() => {}} onRecheck={onRecheck} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Recheck files" }));

    expect(onRecheck).toHaveBeenCalledTimes(1);
  });
});
