import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCodeHQStore, type CodeHQStore } from "@core/store";
import type { CodeHQSnapshot } from "@core/types";

let root: string;
let store: CodeHQStore | null = null;

async function waitFor<T>(check: () => T | undefined | false, timeoutMs = 5000, intervalMs = 30): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = check();
    if (result) {
      return result;
    }
    if (Date.now() > deadline) {
      throw new Error("waitFor timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

function validWorkflowJson(name: string): string {
  return JSON.stringify({
    schemaVersion: "0.1",
    id: "wf",
    name,
    purpose: "A test workflow.",
    steps: [{ id: "step-1", name: "Step 1", purpose: "Does the thing.", category: "entry" }],
    connections: [],
  });
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "codehq-watch-"));
  mkdirSync(path.join(root, ".codehq", "workflows"), { recursive: true });
  writeFileSync(
    path.join(root, ".codehq", "project.json"),
    JSON.stringify({ schemaVersion: "0.1", project: { id: "test", name: "Test" } }),
  );
});

afterEach(async () => {
  if (store !== null) {
    await store.stop();
    store = null;
  }
  rmSync(root, { recursive: true, force: true });
});

describe("watcher + store integration", () => {
  it("picks up a new workflow file, then survives it going invalid, then recovers", async () => {
    store = createCodeHQStore(root);
    await store.reload();
    store.start();

    // chokidar needs a brief moment to actually attach its OS-level watch handles after
    // `watch()` returns; writing before that would-be-missed race is a well known
    // filesystem-watcher testing gotcha, so give it a short, one-time grace period. Every
    // assertion below still uses bounded polling for the real outcome, never a raw sleep.
    await new Promise((resolve) => setTimeout(resolve, 400));

    const workflowFile = path.join(root, ".codehq", "workflows", "wf.json");

    // 1. Writing a brand-new valid workflow file should surface it as "valid".
    writeFileSync(workflowFile, validWorkflowJson("Original Name"));
    const afterCreate = await waitFor<CodeHQSnapshot>(() => {
      const snapshot = store?.getSnapshot();
      return snapshot?.workflows.length === 1 && snapshot.workflows[0]?.state === "valid" ? snapshot : undefined;
    });
    expect(afterCreate.workflows[0]?.workflow.name).toBe("Original Name");

    // 2. Corrupting the file must NOT blank the board: the last valid workflow stays,
    //    marked stale, and diagnostics must explain why.
    writeFileSync(workflowFile, "{ this is not valid json");
    const afterBreak = await waitFor<CodeHQSnapshot>(() => {
      const snapshot = store?.getSnapshot();
      return snapshot?.workflows[0]?.state === "stale" ? snapshot : undefined;
    });
    expect(afterBreak.workflows).toHaveLength(1);
    expect(afterBreak.workflows[0]?.workflow.name).toBe("Original Name");
    expect(afterBreak.workflows[0]?.staleSince).toBeTypeOf("string");
    expect(afterBreak.diagnostics.valid).toBe(false);
    expect(afterBreak.diagnostics.issues.length).toBeGreaterThan(0);
    const diagnosticsFile = path.join(root, ".codehq", "diagnostics.json");
    expect(existsSync(diagnosticsFile)).toBe(true);

    // 3. Repairing the file must bring it back to "valid" and clear the stale marker.
    writeFileSync(workflowFile, validWorkflowJson("Repaired Name"));
    const afterRepair = await waitFor<CodeHQSnapshot>(() => {
      const snapshot = store?.getSnapshot();
      return snapshot?.workflows[0]?.state === "valid" && snapshot.workflows[0]?.workflow.name === "Repaired Name"
        ? snapshot
        : undefined;
    });
    expect(afterRepair.workflows[0]?.staleSince).toBeUndefined();
    expect(afterRepair.diagnostics.valid).toBe(true);
    expect(existsSync(diagnosticsFile)).toBe(false);
  }, 15000);
});
