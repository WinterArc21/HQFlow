import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { WorkflowFreshness, WorkflowRecord } from "@schema/wire";
import { OutdatedNotice } from "@web/components/freshness";
import { recheckOutdatedStepsPrompt } from "@web/lib/agentPrompt";

function makeRecord(outdatedSteps: WorkflowFreshness["outdatedSteps"]): WorkflowRecord {
  return {
    id: "checkout",
    file: ".codehq/workflows/checkout.json",
    modifiedAt: new Date().toISOString(),
    state: "valid",
    sourceChecks: {},
    freshness: { baselineAt: new Date().toISOString(), outdatedSteps },
    workflow: {
      schemaVersion: "0.1",
      id: "checkout",
      name: "Checkout",
      purpose: "Charges the customer.",
      steps: [
        { id: "receive", name: "Receive Order", purpose: "Accepts the order.", category: "entry" },
        { id: "charge", name: "Charge Card", purpose: "Charges the card.", category: "external" },
        { id: "declined", name: "Declined", purpose: "Card was declined.", category: "output" },
      ],
      connections: [],
    },
  } as WorkflowRecord;
}

describe("OutdatedNotice", () => {
  it("renders nothing while every step is current", () => {
    const { container } = render(<OutdatedNotice record={makeRecord({})} onMarkCurrent={async () => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names how many steps may be outdated and which files changed", () => {
    render(
      <OutdatedNotice
        record={makeRecord({
          charge: [{ file: "src/payments.ts", change: "modified" }],
          declined: [{ file: "src/payments.ts", change: "modified" }],
        })}
        onMarkCurrent={async () => {}}
      />,
    );

    expect(screen.getByText("2 steps may be outdated")).toBeInTheDocument();
    expect(screen.getByText("src/payments.ts")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy prompt for your agent" })).toBeInTheDocument();
  });

  it("marks the workflow as up to date through its callback", async () => {
    const onMarkCurrent = vi.fn(async () => {});
    render(
      <OutdatedNotice record={makeRecord({ receive: [{ file: "src/route.ts", change: "deleted" }] })} onMarkCurrent={onMarkCurrent} />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Mark as up to date" }));

    expect(onMarkCurrent).toHaveBeenCalledOnce();
  });
});

describe("recheckOutdatedStepsPrompt", () => {
  it("lists exactly the outdated steps, in workflow order, with what changed", () => {
    const prompt = recheckOutdatedStepsPrompt(
      makeRecord({
        declined: [{ file: "src/payments.ts", change: "modified" }],
        receive: [{ file: "src/route.ts", change: "deleted" }],
      }),
    );

    expect(prompt).toBe(
      [
        "Read .codehq/SKILL.md. Code changed after .codehq/workflows/checkout.json was written. Re-check these steps against the current code:",
        "- Receive Order (receive): src/route.ts was deleted",
        "- Declined (declined): src/payments.ts changed",
        "Update .codehq/workflows/checkout.json wherever it no longer matches the code, keep existing step ids, and run hqflow validate.",
      ].join("\n"),
    );
  });
});
