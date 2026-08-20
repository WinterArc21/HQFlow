import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assignWorkflowToFolder,
  createFolder,
  deleteFolder,
  readFolders,
  renameFolder,
  reorderFolderWorkflows,
} from "@core/folder-store";

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "codehq-folder-store-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("readFolders", () => {
  it("returns an empty folder list when nothing has been saved", async () => {
    const state = await readFolders(root);
    expect(state).toEqual({ folders: [] });
  });
});

describe("createFolder", () => {
  it("adds a new folder with the given name and no workflows, and persists it", async () => {
    const folder = await createFolder(root, "Payments");
    expect(folder.name).toBe("Payments");
    expect(folder.id).toBeTruthy();
    expect(folder.workflowIds).toEqual([]);

    const state = await readFolders(root);
    expect(state.folders).toEqual([folder]);
  });

  it("appends subsequent folders after existing ones, preserving creation order", async () => {
    const first = await createFolder(root, "Payments");
    const second = await createFolder(root, "Onboarding");

    const state = await readFolders(root);
    expect(state.folders).toEqual([first, second]);
  });
});

describe("renameFolder", () => {
  it("updates the name of an existing folder, leaving its id and workflows unchanged", async () => {
    const folder = await createFolder(root, "Payments");
    await assignWorkflowToFolder(root, "checkout", folder.id);

    await renameFolder(root, folder.id, "Billing");

    const state = await readFolders(root);
    expect(state.folders).toEqual([{ id: folder.id, name: "Billing", workflowIds: ["checkout"] }]);
  });

  it("throws when the folder id does not exist", async () => {
    await expect(renameFolder(root, "does-not-exist", "Billing")).rejects.toThrow();
  });
});

describe("assignWorkflowToFolder", () => {
  it("appends a workflow to a folder's workflowIds", async () => {
    const folder = await createFolder(root, "Payments");

    await assignWorkflowToFolder(root, "checkout", folder.id);

    const state = await readFolders(root);
    expect(state.folders[0]?.workflowIds).toEqual(["checkout"]);
  });

  it("moves a workflow out of its previous folder when assigned to a new one", async () => {
    const payments = await createFolder(root, "Payments");
    const onboarding = await createFolder(root, "Onboarding");
    await assignWorkflowToFolder(root, "checkout", payments.id);

    await assignWorkflowToFolder(root, "checkout", onboarding.id);

    const state = await readFolders(root);
    expect(state.folders.find((f) => f.id === payments.id)?.workflowIds).toEqual([]);
    expect(state.folders.find((f) => f.id === onboarding.id)?.workflowIds).toEqual(["checkout"]);
  });

  it("unassigns a workflow when given a null folder id", async () => {
    const folder = await createFolder(root, "Payments");
    await assignWorkflowToFolder(root, "checkout", folder.id);

    await assignWorkflowToFolder(root, "checkout", null);

    const state = await readFolders(root);
    expect(state.folders[0]?.workflowIds).toEqual([]);
  });

  it("throws when assigning to an unknown folder id", async () => {
    await expect(assignWorkflowToFolder(root, "checkout", "does-not-exist")).rejects.toThrow();
  });
});

describe("deleteFolder", () => {
  it("removes the folder; its workflows simply stop appearing in any folder", async () => {
    const payments = await createFolder(root, "Payments");
    const onboarding = await createFolder(root, "Onboarding");
    await assignWorkflowToFolder(root, "checkout", payments.id);
    await assignWorkflowToFolder(root, "welcome", onboarding.id);

    await deleteFolder(root, payments.id);

    const state = await readFolders(root);
    expect(state.folders).toEqual([{ id: onboarding.id, name: "Onboarding", workflowIds: ["welcome"] }]);
  });

  it("is a no-op when the folder id does not exist", async () => {
    await expect(deleteFolder(root, "does-not-exist")).resolves.not.toThrow();
  });
});

describe("reorderFolderWorkflows", () => {
  it("replaces the folder's workflow order", async () => {
    const folder = await createFolder(root, "Payments");
    await assignWorkflowToFolder(root, "checkout", folder.id);
    await assignWorkflowToFolder(root, "refund", folder.id);
    await assignWorkflowToFolder(root, "invoice", folder.id);

    await reorderFolderWorkflows(root, folder.id, ["invoice", "checkout", "refund"]);

    const state = await readFolders(root);
    expect(state.folders[0]?.workflowIds).toEqual(["invoice", "checkout", "refund"]);
  });

  it("throws when the new order doesn't contain exactly the current members", async () => {
    const folder = await createFolder(root, "Payments");
    await assignWorkflowToFolder(root, "checkout", folder.id);

    await expect(reorderFolderWorkflows(root, folder.id, ["checkout", "refund"])).rejects.toThrow();
    await expect(reorderFolderWorkflows(root, folder.id, [])).rejects.toThrow();
  });

  it("throws when the folder id does not exist", async () => {
    await expect(reorderFolderWorkflows(root, "does-not-exist", [])).rejects.toThrow();
  });
});
