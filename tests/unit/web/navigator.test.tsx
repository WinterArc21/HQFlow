import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WorkflowNavigator } from "@web/components/navigator/WorkflowNavigator";
import type { WorkflowRecord } from "@web/api/types";

function makeRecord(id: string, name: string): WorkflowRecord {
  return {
    id,
    file: `.codehq/workflows/${id}.json`,
    workflow: {
      schemaVersion: "0.1",
      id,
      name,
      purpose: `Purpose for ${name}.`,
      steps: [{ id: "step-1", name: "Step 1", purpose: "Does something." }],
      connections: [],
    },
    modifiedAt: new Date().toISOString(),
    state: "valid",
    sourceChecks: {},
  };
}

describe("WorkflowNavigator", () => {
  const records = [makeRecord("alpha", "Alpha"), makeRecord("beta", "Beta"), makeRecord("gamma", "Gamma")];

  it("selects a workflow via a mouse click", async () => {
    const onSelect = vi.fn();
    render(<WorkflowNavigator workflows={records} selectedWorkflowId={null} onSelect={onSelect} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Beta/ }));

    expect(onSelect).toHaveBeenCalledWith("beta");
  });

  it("selects a workflow via the keyboard (Tab, Arrow Down, Enter)", async () => {
    const onSelect = vi.fn();
    render(<WorkflowNavigator workflows={records} selectedWorkflowId={null} onSelect={onSelect} />);

    const user = userEvent.setup();
    await user.tab(); // focuses the collapse control
    await user.tab(); // focuses the first workflow button (Alpha)
    await user.keyboard("{ArrowDown}"); // moves focus to the second (Beta)
    await user.keyboard("{Enter}");

    expect(onSelect).toHaveBeenCalledWith("beta");
  });

  it("exposes the selected workflow to assistive tech via aria-current", () => {
    render(<WorkflowNavigator workflows={records} selectedWorkflowId="beta" onSelect={() => {}} />);

    expect(screen.getByRole("button", { name: /Beta/ })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: /Alpha/ })).not.toHaveAttribute("aria-current");
  });

  it("shows the repository overview and planned workflows", async () => {
    const onSelect = vi.fn();
    render(
      <WorkflowNavigator
        repositoryName="ACME Store"
        repositoryMap={{
          file: ".codehq/repository-map.json",
          modifiedAt: new Date().toISOString(),
          state: "valid",
          repositoryMap: {
            schemaVersion: "0.1",
            workflows: [
              { id: "alpha", name: "Alpha", purpose: "Alpha purpose." },
              { id: "billing", name: "Billing", purpose: "Bills customers." },
            ],
            connections: [],
          },
        }}
        workflows={[records[0]!]}
        selectedWorkflowId={null}
        onSelect={onSelect}
      />,
    );

    const overview = screen.getByRole("button", { name: "ACME Store overview" });
    expect(overview).toHaveAttribute("aria-current", "page");
    expect(overview).toHaveTextContent("Overview · repo-wide map");
    expect(screen.getByText("Billing")).toBeInTheDocument();
    expect(screen.getByText("Not mapped")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "ACME Store workflows" })).toBeInTheDocument();

    await userEvent.click(overview);
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});
