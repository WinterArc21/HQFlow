/**
 * THE CORE PRODUCT PROMISE: edits to a workflow file on disk are reflected on the board over
 * SSE, with no `page.reload()` anywhere in this file.
 *
 * Isolation: owns port 4501 (helpers/paths.ts PORTS.liveUpdate) and uses a private temp copy of
 * the test project for every test. This file runs serially because its tests intentionally share
 * that one port; other spec files still run in parallel on their own dedicated ports.
 */
import { promises as fsp } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { createTempFixtureCopy, removeTempDir } from "./helpers/fixture";
import { PORTS } from "./helpers/paths";
import { startCodeHQServer, type ManagedServer } from "./helpers/server";

interface MinimalWorkflowFile {
  steps: Array<{ id: string; name: string; [key: string]: unknown }>;
  connections: Array<{ from: string; to: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

let root: string;
let server: ManagedServer;

// Every test owns a fresh fixture, but this spec intentionally shares one dedicated port.
// Override the suite-wide fullyParallel setting so concurrent workers cannot attach to the
// wrong test's server.
test.describe.configure({ mode: "serial" });

test.beforeEach(async () => {
  root = await createTempFixtureCopy("live-update");
  server = await startCodeHQServer(root, PORTS.liveUpdate);
});

test.afterEach(async () => {
  await server.stop();
  await removeTempDir(root);
});

test("renaming a step, then adding a step and connection, both appear live without a page reload", async ({ page }) => {
  await page.goto(server.url);
  await page.locator("[data-step-node]").first().waitFor({ state: "visible", timeout: 15_000 });
  await expect(page.locator("[data-step-node]")).toHaveCount(11);

  const workflowFile = path.join(root, ".codehq", "workflows", "generate-video.json");
  const original = JSON.parse(await fsp.readFile(workflowFile, "utf-8")) as MinimalWorkflowFile;

  // --- Step 1: rename a step ---------------------------------------------------------------
  const renamed = structuredClone(original);
  const receiveRequest = renamed.steps.find((step) => step.id === "receive-request");
  if (receiveRequest === undefined) {
    throw new Error("Fixture changed: expected a 'receive-request' step in generate-video.json.");
  }
  receiveRequest.name = "Receive Incoming Request";
  await fsp.writeFile(workflowFile, `${JSON.stringify(renamed, null, 2)}\n`, "utf-8");

  await expect(page.locator('[data-step-node="receive-request"]')).toContainText("Receive Incoming Request", {
    timeout: 10_000,
  });
  await expect(page.getByText("Receive Request", { exact: true })).toHaveCount(0);

  // --- Step 2: add a new step plus a connection into it -------------------------------------
  const withNewStep = structuredClone(renamed);
  withNewStep.steps.push({
    id: "post-process-video",
    name: "Post-process Video",
    purpose: "Applies final color and audio mastering before delivery.",
    category: "logic",
  });
  withNewStep.connections.push({ from: "save-result", to: "post-process-video" });
  await fsp.writeFile(workflowFile, `${JSON.stringify(withNewStep, null, 2)}\n`, "utf-8");

  await expect(page.locator("[data-step-node]")).toHaveCount(12, { timeout: 10_000 });
  await expect(page.locator('[data-step-node="post-process-video"]')).toContainText("Post-process Video");
  await expect(page.locator(".react-flow__edge")).toHaveCount(11, { timeout: 10_000 });
});

test("new graph elements animate in without detaching existing connectors", async ({ page }) => {
  await page.goto(server.url);
  await page.locator("[data-step-node]").first().waitFor({ state: "visible", timeout: 15_000 });

  // New edges should have an enter animation (animation-name is not "none").
  const existingEdgeAnimation = await page.locator(".react-flow__edge").first().evaluate((el) => {
    return getComputedStyle(el).animationName;
  });
  expect(existingEdgeAnimation).not.toBe("none");

  // Add a new step to trigger a live update, then verify the new node's wrapper has an enter
  // animation (animation-name is not "none") while existing nodes retain their transform transition.
  const workflowFile = path.join(root, ".codehq", "workflows", "generate-video.json");
  const current = JSON.parse(await fsp.readFile(workflowFile, "utf-8")) as MinimalWorkflowFile;
  const withExtraStep = structuredClone(current);
  withExtraStep.steps.push({
    id: "quality-check",
    name: "Quality Check",
    purpose: "Verifies output quality before delivery.",
    category: "decision",
  });
  // Turning an existing terminal outcome into a work step forces it to move from the outcome
  // column back to the main line. Connectors must snap with it rather than remaining at the final
  // geometry while the node glides independently.
  withExtraStep.connections.push({ from: "outcome-generation-created", to: "quality-check" });
  await fsp.writeFile(workflowFile, `${JSON.stringify(withExtraStep, null, 2)}\n`, "utf-8");

  await expect(page.locator('[data-step-node="quality-check"]')).toBeVisible({ timeout: 10_000 });

  // The enter animation (nodeEnter keyframe) is on the .react-flow__node wrapper, not the card
  // inside — see WorkflowCanvas.module.css for why the opacity animation must be on the wrapper.
  const newNodeAnimation = await page
    .locator('.react-flow__node[data-id="quality-check"]')
    .evaluate((el) => getComputedStyle(el).animationName);
  expect(newNodeAnimation).not.toBe("none");

  const incomingEdgeId = "save-result->outcome-generation-created#9";
  const connectorDistance = await page.evaluate((edgeId) => {
    const targetHandle = document.querySelector<HTMLElement>('[data-nodeid="outcome-generation-created"][data-handleid="in-top"]');
    const path = document.querySelector<SVGPathElement>(
      `.react-flow__edge[data-id="${edgeId}"] path.react-flow__edge-path`,
    );
    if (targetHandle === null || path === null) {
      return Number.POSITIVE_INFINITY;
    }
    const rect = targetHandle.getBoundingClientRect();
    const endpoint = path.getPointAtLength(path.getTotalLength());
    const screenEndpoint = new DOMPoint(endpoint.x, endpoint.y).matrixTransform(path.getScreenCTM() ?? new DOMMatrix());
    return Math.hypot(screenEndpoint.x - (rect.left + rect.width / 2), screenEndpoint.y - (rect.top + rect.height / 2));
  }, incomingEdgeId);
  // The horizontal canvas attaches incoming connections to the target's live facing handle,
  // rather than the card centre. A larger gap means node and edge geometry diverged during the
  // live update.
  expect(connectorDistance).toBeLessThan(5);
});
