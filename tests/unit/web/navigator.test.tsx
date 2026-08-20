import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
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

  it("renders every workflow's name", () => {
    render(<WorkflowNavigator workflows={records} selectedWorkflowId={null} onSelect={() => {}} />);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Gamma")).toBeInTheDocument();
  });

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

  it("collapses and expands from the keyboard without changing the selected workflow", async () => {
    render(<WorkflowNavigator workflows={records} selectedWorkflowId="beta" onSelect={() => {}} />);

    const user = userEvent.setup();
    const collapseButton = screen.getByRole("button", { name: "Collapse workflows rail" });
    expect(collapseButton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /Beta/ })).toHaveAttribute("aria-current", "true");

    collapseButton.focus();
    await user.keyboard("{Enter}");

    const expandButton = screen.getByRole("button", { name: "Expand workflows rail" });
    expect(expandButton).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /Beta/ })).not.toBeInTheDocument();

    await user.keyboard("{Enter}");

    expect(screen.getByRole("button", { name: "Collapse workflows rail" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /Beta/ })).toHaveAttribute("aria-current", "true");
  });

  it("supports the controlled state used by App", async () => {
    function ControlledNavigator() {
      const [collapsed, setCollapsed] = useState(false);
      return (
        <WorkflowNavigator
          workflows={records}
          selectedWorkflowId="alpha"
          onSelect={() => {}}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((current) => !current)}
        />
      );
    }

    render(<ControlledNavigator />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Collapse workflows rail" }));
    expect(screen.getByRole("button", { name: "Expand workflows rail" })).toHaveAttribute("aria-expanded", "false");

    await user.click(screen.getByRole("button", { name: "Expand workflows rail" }));
    expect(screen.getByRole("button", { name: /Alpha/ })).toHaveAttribute("aria-current", "true");
  });
});

describe("WorkflowNavigator folders", () => {
  const records = [makeRecord("alpha", "Alpha"), makeRecord("beta", "Beta"), makeRecord("gamma", "Gamma")];

  it("nests workflows under their assigned folder and leaves unassigned workflows at the top level", () => {
    const folderState = {
      folders: [{ id: "folder-1", name: "Payments", workflowIds: ["alpha", "beta"] }],
    };

    render(
      <WorkflowNavigator workflows={records} selectedWorkflowId={null} onSelect={() => {}} folderState={folderState} />,
    );

    expect(screen.getByRole("button", { name: "Payments" })).toBeInTheDocument();
    const folderGroup = screen.getByRole("group", { name: "Payments" });
    expect(within(folderGroup).getByText("Alpha")).toBeInTheDocument();
    expect(within(folderGroup).getByText("Beta")).toBeInTheDocument();
    expect(within(folderGroup).queryByText("Gamma")).not.toBeInTheDocument();
    expect(screen.getByText("Gamma")).toBeInTheDocument();
  });

  it("creates a folder with the typed name via the New folder control", async () => {
    const onCreateFolder = vi.fn();
    render(
      <WorkflowNavigator
        workflows={records}
        selectedWorkflowId={null}
        onSelect={() => {}}
        folderState={{ folders: [] }}
        onCreateFolder={onCreateFolder}
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "New folder" }));
    await user.type(screen.getByLabelText("Folder name"), "Payments{Enter}");

    expect(onCreateFolder).toHaveBeenCalledWith("Payments");
  });

  it("moves a workflow into a folder via its Move to... menu action", async () => {
    const onAssignWorkflowToFolder = vi.fn();
    const folderState = { folders: [{ id: "folder-1", name: "Payments", workflowIds: [] }] };
    render(
      <WorkflowNavigator
        workflows={records}
        selectedWorkflowId={null}
        onSelect={() => {}}
        folderState={folderState}
        onAssignWorkflowToFolder={onAssignWorkflowToFolder}
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Actions for Alpha" }));
    await user.click(screen.getByRole("menuitem", { name: "Move to Payments" }));

    expect(onAssignWorkflowToFolder).toHaveBeenCalledWith("alpha", "folder-1");
  });

  it("renames a folder via its Actions menu", async () => {
    const onRenameFolder = vi.fn();
    const folderState = { folders: [{ id: "folder-1", name: "Payments", workflowIds: [] }] };
    render(
      <WorkflowNavigator
        workflows={records}
        selectedWorkflowId={null}
        onSelect={() => {}}
        folderState={folderState}
        onRenameFolder={onRenameFolder}
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Actions for Payments" }));
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    const input = screen.getByLabelText("Rename Payments");
    await user.clear(input);
    await user.type(input, "Billing{Enter}");

    expect(onRenameFolder).toHaveBeenCalledWith("folder-1", "Billing");
  });

  it("deletes a folder via its Actions menu", async () => {
    const onDeleteFolder = vi.fn();
    const folderState = { folders: [{ id: "folder-1", name: "Payments", workflowIds: [] }] };
    render(
      <WorkflowNavigator
        workflows={records}
        selectedWorkflowId={null}
        onSelect={() => {}}
        folderState={folderState}
        onDeleteFolder={onDeleteFolder}
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Actions for Payments" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));

    expect(onDeleteFolder).toHaveBeenCalledWith("folder-1");
  });

  it("collapses and expands a folder, hiding and showing its workflows", async () => {
    const folderState = { folders: [{ id: "folder-1", name: "Payments", workflowIds: ["alpha"] }] };
    render(
      <WorkflowNavigator workflows={records} selectedWorkflowId={null} onSelect={() => {}} folderState={folderState} />,
    );
    const user = userEvent.setup();

    expect(screen.getByText("Alpha")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Payments" }));
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Payments" }));
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });

  it("reorders a folder's workflows via Move up / Move down menu actions", async () => {
    const onReorderFolder = vi.fn();
    const folderState = { folders: [{ id: "folder-1", name: "Payments", workflowIds: ["alpha", "beta", "gamma"] }] };
    render(
      <WorkflowNavigator
        workflows={records}
        selectedWorkflowId={null}
        onSelect={() => {}}
        folderState={folderState}
        onReorderFolder={onReorderFolder}
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Actions for Beta" }));
    await user.click(screen.getByRole("menuitem", { name: "Move up" }));

    expect(onReorderFolder).toHaveBeenCalledWith("folder-1", ["beta", "alpha", "gamma"]);
  });

  it("omits Move up for the first workflow in a folder and Move down for the last", async () => {
    const folderState = { folders: [{ id: "folder-1", name: "Payments", workflowIds: ["alpha", "beta"] }] };
    render(
      <WorkflowNavigator
        workflows={records}
        selectedWorkflowId={null}
        onSelect={() => {}}
        folderState={folderState}
        onReorderFolder={() => {}}
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Actions for Alpha" }));
    expect(screen.queryByRole("menuitem", { name: "Move up" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Move down" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Actions for Beta" }));
    expect(screen.getByRole("menuitem", { name: "Move up" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Move down" })).not.toBeInTheDocument();
  });
});
