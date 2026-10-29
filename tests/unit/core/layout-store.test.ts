import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deleteWorkflowCanvasLayout,
  readWorkflowCanvasLayout,
  writeWorkflowCanvasLayout,
} from "@core/layout-store";
import type { WorkflowCanvasLayout } from "@schema/wire";

let root: string;

const layout: WorkflowCanvasLayout = {
  nodePositions: { receive: { x: 12, y: 34 } },
};

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "hqflow-layout-store-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("canvas layout store", () => {
  it("returns null when a workflow has no saved layout", async () => {
    await expect(readWorkflowCanvasLayout(root, "missing")).resolves.toBeNull();
  });

  it("writes versioned layout data and reads it back", async () => {
    await writeWorkflowCanvasLayout(root, "generate-video", layout);

    await expect(readWorkflowCanvasLayout(root, "generate-video")).resolves.toEqual(layout);
    const file = JSON.parse(await fs.readFile(path.join(root, ".codehq", ".runtime", "layout.json"), "utf-8")) as unknown;
    expect(file).toEqual({ version: 1, workflows: { "generate-video": layout } });
  });

  it("drops saved bends without losing card positions in any view", async () => {
    const runtime = path.join(root, ".codehq", ".runtime");
    const oldGeometry = { ...layout, edgeBends: { e: { point: { x: 56, y: 78 }, snap: null } } };
    await fs.mkdir(runtime, { recursive: true });
    await fs.writeFile(path.join(runtime, "layout.json"), JSON.stringify({
      version: 1,
      workflows: { wf: { ...oldGeometry, view: "flow", otherViews: { wrap: oldGeometry } } },
    }));

    const restored = await readWorkflowCanvasLayout(root, "wf");
    expect(restored).toEqual({ ...layout, view: "flow", otherViews: { wrap: layout } });
    await writeWorkflowCanvasLayout(root, "another", layout);
    expect(await fs.readFile(path.join(runtime, "layout.json"), "utf-8")).not.toContain("edgeBends");
  });

  it("serializes concurrent writes for different workflows", async () => {
    await Promise.all([
      writeWorkflowCanvasLayout(root, "workflow-a", layout),
      writeWorkflowCanvasLayout(root, "workflow-b", { nodePositions: {} }),
    ]);

    await expect(readWorkflowCanvasLayout(root, "workflow-a")).resolves.toEqual(layout);
    await expect(readWorkflowCanvasLayout(root, "workflow-b")).resolves.toEqual({ nodePositions: {} });
  });

  it("deletes only the requested workflow layout", async () => {
    await writeWorkflowCanvasLayout(root, "workflow-a", layout);
    await writeWorkflowCanvasLayout(root, "workflow-b", layout);

    await deleteWorkflowCanvasLayout(root, "workflow-a");

    await expect(readWorkflowCanvasLayout(root, "workflow-a")).resolves.toBeNull();
    await expect(readWorkflowCanvasLayout(root, "workflow-b")).resolves.toEqual(layout);
  });
});
