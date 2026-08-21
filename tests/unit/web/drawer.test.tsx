import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Workflow } from "@schema/workflow";
import type { SourceStatus } from "@web/api/types";
import { StepDrawer } from "@web/components/drawer/StepDrawer";

const WORKFLOW: Workflow = {
  schemaVersion: "0.1",
  id: "demo",
  name: "Demo Workflow",
  purpose: "Demonstrates the drawer.",
  steps: [
    {
      id: "main",
      name: "Process Payment",
      purpose: "Captures the customer's payment.",
      category: "external",
      sources: [
        { file: "src/payments/capture.ts", symbol: "capturePayment", line: 10, endLine: 20 },
        { file: "src/payments/missing.ts", symbol: "doesNotExist" },
      ],
      inputs: [{ name: "Cart", type: "Cart", description: "The validated cart." }],
      outputs: [{ name: "Receipt" }],
      edgeCases: [
        {
          name: "Card declined",
          description: "The card issuer declines the charge.",
          handling: "Return 402.",
        },
      ],
      tests: [{ file: "tests/unit/payments.test.ts", symbol: "declines a bad card" }],
      externalServices: [{ name: "Stripe", purpose: "Processes the charge.", operation: "POST /charges" }],
      details: {
        implementation: "Uses the Stripe SDK directly.",
        importantDecisions: ["Retries are capped at 1 attempt."],
        assumptions: ["The cart total is already in the smallest currency unit."],
      },
    },
    {
      id: "sparse",
      name: "Sparse Step",
      purpose: "Has nothing else set.",
    },
  ],
  connections: [{ from: "main", to: "sparse", type: "success", label: "done" }],
};

const SOURCE_CHECKS: Record<string, SourceStatus> = {
  "src/payments/capture.ts#capturePayment": "found",
  "src/payments/missing.ts#doesNotExist": "missing",
};

function DrawerHarness() {
  const [open, setOpen] = useState(false);
  const [stepId, setStepId] = useState("main");
  return (
    <div>
      <button onClick={() => setOpen(true)}>Open drawer</button>
      {open ? (
        <StepDrawer
          workflow={WORKFLOW}
          stepId={stepId}
          sourceChecks={SOURCE_CHECKS}
          onClose={() => setOpen(false)}
          onSelectStep={setStepId}
        />
      ) : null}
    </div>
  );
}

describe("StepDrawer", () => {
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

  it("renders every section that has data, for a richly-populated step", () => {
    render(<StepDrawer workflow={WORKFLOW} stepId="main" sourceChecks={SOURCE_CHECKS} onClose={() => {}} onSelectStep={() => {}} />);

    for (const heading of [
      "Inputs",
      "Outputs",
      "Source references",
      "Edge cases",
      "Tests",
      "External services",
      "Implementation",
      "Decisions & assumptions",
      "Connections",
    ]) {
      expect(screen.getByText(heading)).toBeInTheDocument();
    }
    expect(screen.getByText("Process Payment")).toBeInTheDocument();
    expect(screen.getByText(/Step 1 of 2/)).toBeInTheDocument();
  });

  it("counts each list section on its heading — the card no longer carries those counts", () => {
    render(<StepDrawer workflow={WORKFLOW} stepId="main" sourceChecks={SOURCE_CHECKS} onClose={() => {}} onSelectStep={() => {}} />);

    for (const [heading, count] of [
      ["Source references", "2"],
      ["Edge cases", "1"],
      ["Tests", "1"],
      ["Inputs", "1"],
      ["Outputs", "1"],
      ["External services", "1"],
    ] as const) {
      expect(within(screen.getByRole("region", { name: heading })).getByText(count)).toBeInTheDocument();
    }
  });

  it("omits every section that has no data, for a sparse step", () => {
    render(<StepDrawer workflow={WORKFLOW} stepId="sparse" sourceChecks={{}} onClose={() => {}} onSelectStep={() => {}} />);

    for (const heading of [
      "Inputs",
      "Outputs",
      "Source references",
      "Edge cases",
      "Tests",
      "External services",
      "Implementation",
      "Decisions & assumptions",
    ]) {
      expect(screen.queryByText(heading)).not.toBeInTheDocument();
    }
    // The sparse step is still the target of one incoming connection, so that section remains.
    expect(screen.getByText("Connections")).toBeInTheDocument();
  });

  it("renders an honest, distinct label for each source check state", () => {
    render(<StepDrawer workflow={WORKFLOW} stepId="main" sourceChecks={SOURCE_CHECKS} onClose={() => {}} onSelectStep={() => {}} />);

    expect(screen.getByText("File found")).toBeInTheDocument();
    expect(screen.getByText("File not found")).toBeInTheDocument();
  });

  it("copies the exact repository-relative path when 'Copy path' is used", async () => {
    const clipboard = navigator.clipboard as unknown as { writeText: (text: string) => Promise<void> };
    render(<StepDrawer workflow={WORKFLOW} stepId="main" sourceChecks={SOURCE_CHECKS} onClose={() => {}} onSelectStep={() => {}} />);

    const copyButtons = screen.getAllByRole("button", { name: "Copy path" });
    fireEvent.click(copyButtons[0] as HTMLButtonElement);

    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith("src/payments/capture.ts"));
  });

  it("selects the connected step when a connection row is clicked", async () => {
    const onSelectStep = vi.fn();
    render(<StepDrawer workflow={WORKFLOW} stepId="main" sourceChecks={{}} onClose={() => {}} onSelectStep={onSelectStep} />);

    const connections = screen.getByLabelText("Connections");
    const user = userEvent.setup();
    await user.click(within(connections).getByRole("button", { name: /Sparse Step/ }));

    expect(onSelectStep).toHaveBeenCalledWith("sparse");
  });

  it("closes on Escape and restores focus to the element that opened it", async () => {
    render(<DrawerHarness />);
    const user = userEvent.setup();

    const openButton = screen.getByRole("button", { name: "Open drawer" });
    openButton.focus();
    await user.click(openButton);

    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(openButton).toHaveFocus();
  });
});
