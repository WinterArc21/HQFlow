import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Workflow } from "@schema/workflow";
import { StepCard, type StepCardProps } from "@web/components/canvas/StepCard";

const WORKFLOW: Workflow = {
  schemaVersion: "0.1",
  id: "demo",
  name: "Demo Workflow",
  purpose: "Demonstrates the step card.",
  steps: [
    {
      id: "validate",
      name: "Validate Request",
      purpose: "Checks the URL and normalizes the tone.",
      category: "decision",
      sources: [{ file: "lib/validation.ts", symbol: "validateGenerateRequest" }],
      inputs: [{ name: "GenerateRequestBody" }],
      outputs: [{ name: "ValidatedGenerateRequest" }],
      edgeCases: [
        { name: "Malformed or unreachable URL", description: "The URL is not http(s).", handling: "Returns a 400." },
        { name: "Too many reference images", description: "More than six images.", handling: "Returns a 400." },
      ],
    },
    { id: "quota", name: "Check Quota", purpose: "Confirms the monthly quota." },
  ],
  connections: [{ from: "validate", to: "quota", type: "success", label: "valid" }],
};

function renderCard(overrides: Partial<StepCardProps> = {}) {
  const props: StepCardProps = {
    workflow: WORKFLOW,
    step: WORKFLOW.steps[0]!,
    stepNumber: 1,
    sourceChecks: {},
    origin: { x: 0, y: 0 },
    growsLeft: false,
    onClose: vi.fn(),
    onOpenFull: vi.fn(),
    onWalk: vi.fn(),
    ...overrides,
  };
  render(<StepCard {...props} />);
  return props;
}

describe("StepCard", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network calls are not expected in this test")));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens on the overview with the step's purpose and data, and takes focus", () => {
    renderCard();
    const card = screen.getByRole("dialog", { name: "Validate Request" });
    expect(card).toHaveFocus();
    expect(card).toHaveTextContent("Checks the URL and normalizes the tone.");
    expect(within(card).getByRole("region", { name: "Inputs" })).toHaveTextContent("GenerateRequestBody");
  });

  it("splits the details into Overview, Source and Edge cases tabs, with no Connections tab", async () => {
    renderCard();
    const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent);
    expect(tabs).toEqual(["Overview", "Source1", "Edge cases2"]);

    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /Edge cases/ }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Malformed or unreachable URL");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Too many reference images");
  });

  it("keeps connections in the accessibility tree only", () => {
    renderCard();
    const connections = screen.getByRole("region", { name: "Connections" });
    expect(connections).toHaveTextContent("To Check Quota, when valid");
    expect(within(connections).queryByRole("button")).not.toBeInTheDocument();
  });

  it("walks the flow with the arrow keys and closes on Escape", () => {
    const props = renderCard();
    const card = screen.getByRole("dialog", { name: "Validate Request" });
    fireEvent.keyDown(card, { key: "ArrowRight" });
    fireEvent.keyDown(card, { key: "ArrowLeft" });
    expect(props.onWalk).toHaveBeenNthCalledWith(1, 1);
    expect(props.onWalk).toHaveBeenNthCalledWith(2, -1);
    fireEvent.keyDown(card, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("hands a long step to the full side panel", async () => {
    const props = renderCard();
    await userEvent.setup().click(screen.getByRole("button", { name: "Open full step details" }));
    expect(props.onOpenFull).toHaveBeenCalledTimes(1);
  });

  it("says so when a step has no source or edge cases mapped", async () => {
    renderCard({ step: WORKFLOW.steps[1]!, stepNumber: 2 });
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Source" }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("No source files mapped for this step.");
    await user.click(screen.getByRole("tab", { name: "Edge cases" }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("No edge cases mapped for this step.");
  });
});
