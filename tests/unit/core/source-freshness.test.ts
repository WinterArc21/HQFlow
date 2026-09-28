import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeWorkflowFreshness, resetWorkflowBaseline } from "@core/source-freshness";
import type { Workflow } from "@schema/workflow";

let root: string;

function checkoutWorkflow(purpose = "Charges the customer."): Workflow {
  return {
    schemaVersion: "0.1",
    id: "checkout",
    name: "Checkout",
    purpose,
    steps: [
      { id: "receive", name: "Receive", purpose: "Accepts the request.", category: "entry", sources: [{ file: "src/route.ts" }] },
      {
        id: "charge",
        name: "Charge",
        purpose: "Charges the card.",
        category: "external",
        sources: [{ file: "src/payments.ts", symbol: "charge" }],
        tests: [{ file: "test/payments.test.ts" }],
      },
      {
        id: "declined",
        name: "Declined",
        purpose: "Card was declined.",
        category: "output",
        edgeCases: [{ name: "Declined card", sources: [{ file: "src/payments.ts" }] }],
      },
    ],
    connections: [
      { from: "receive", to: "charge" },
      { from: "charge", to: "declined", type: "failure" },
    ],
  } as Workflow;
}

async function write(file: string, contents: string): Promise<void> {
  const absolute = path.join(root, file);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, contents, "utf-8");
}

async function freshness(workflow: Workflow = checkoutWorkflow()) {
  const result = (await computeWorkflowFreshness(root, [{ id: workflow.id, workflow }])).get(workflow.id);
  if (result === undefined) {
    throw new Error("expected a freshness result");
  }
  return result;
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "hqflow-freshness-"));
  await write("src/route.ts", "export const route = 1;\n");
  await write("src/payments.ts", "export function charge() {}\n");
  await write("test/payments.test.ts", "it('charges', () => {});\n");
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("source freshness", () => {
  it("records a baseline the first time it sees a workflow and reports nothing outdated", async () => {
    const result = await freshness();

    expect(result.outdatedSteps).toEqual({});
    const stored = JSON.parse(await fs.readFile(path.join(root, ".codehq", ".runtime", "source-baselines.json"), "utf-8")) as {
      workflows: Record<string, { files: Record<string, string | null> }>;
    };
    expect(Object.keys(stored.workflows.checkout?.files ?? {}).sort()).toEqual([
      "src/payments.ts",
      "src/route.ts",
      "test/payments.test.ts",
    ]);
  });

  it("flags every step that points at a modified file, including through tests and edge cases", async () => {
    const baseline = await freshness();
    await write("src/payments.ts", "export function charge() { return 'v2'; }\n");

    const result = await freshness();

    expect(result.baselineAt).toBe(baseline.baselineAt);
    expect(result.outdatedSteps).toEqual({
      charge: [{ file: "src/payments.ts", change: "modified" }],
      declined: [{ file: "src/payments.ts", change: "modified" }],
    });
  });

  it("reports a referenced file deleted after the baseline", async () => {
    await freshness();
    await fs.rm(path.join(root, "src/route.ts"));

    expect((await freshness()).outdatedSteps).toEqual({ receive: [{ file: "src/route.ts", change: "deleted" }] });
  });

  it("clears the flag when the edit is reverted to the baselined contents", async () => {
    await freshness();
    await write("src/route.ts", "export const route = 2;\n");
    expect(Object.keys((await freshness()).outdatedSteps)).toEqual(["receive"]);

    await write("src/route.ts", "export const route = 1;\n");
    expect((await freshness()).outdatedSteps).toEqual({});
  });

  it("treats a line-ending-only change as unchanged", async () => {
    await freshness();
    await write("src/route.ts", "export const route = 1;\r\n");

    expect((await freshness()).outdatedSteps).toEqual({});
  });

  it("records a fresh baseline when the workflow itself is rewritten", async () => {
    await freshness();
    await write("src/payments.ts", "export function charge() { return 'v2'; }\n");
    expect(Object.keys((await freshness()).outdatedSteps)).toHaveLength(2);

    const result = await freshness(checkoutWorkflow("Charges the customer, re-checked."));

    expect(result.outdatedSteps).toEqual({});
  });

  it("does not track a file that was already missing when the baseline was recorded", async () => {
    await fs.rm(path.join(root, "test/payments.test.ts"));
    await freshness();
    await write("test/payments.test.ts", "it('now exists', () => {});\n");

    expect((await freshness()).outdatedSteps).toEqual({});
  });

  it("marks the current code as up to date after a reset", async () => {
    await freshness();
    await write("src/route.ts", "export const route = 2;\n");
    expect(Object.keys((await freshness()).outdatedSteps)).toEqual(["receive"]);

    await resetWorkflowBaseline(root, "checkout");

    expect((await freshness()).outdatedSteps).toEqual({});
  });

  it("drops baselines for workflows that no longer exist and recovers from a corrupt runtime file", async () => {
    await freshness();
    const baselineFile = path.join(root, ".codehq", ".runtime", "source-baselines.json");

    await computeWorkflowFreshness(root, []);
    const stored = JSON.parse(await fs.readFile(baselineFile, "utf-8")) as { workflows: Record<string, unknown> };
    expect(stored.workflows).toEqual({});

    await fs.writeFile(baselineFile, "{ not json", "utf-8");
    expect((await freshness()).outdatedSteps).toEqual({});
  });
});
