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
import { waitForBoot } from "./helpers/app";
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
  await waitForBoot(page);
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

test("a card that moves in a live edit keeps its connector attached", async ({ page }) => {
  await page.goto(server.url);
  await waitForBoot(page);

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

  const incomingEdgeId = "save-result->outcome-generation-created#9";
  const connectorDistance = await page.evaluate((edgeId) => {
    // The step moves onto the main line with the new layout, so whichever side faces its source
    // takes the edge; attached means the line ends on one of the step's target handles.
    const targetHandles = [...document.querySelectorAll<HTMLElement>('[data-nodeid="outcome-generation-created"].react-flow__handle.target')];
    const path = document.querySelector<SVGPathElement>(
      `.react-flow__edge[data-id="${edgeId}"] path.react-flow__edge-path`,
    );
    if (targetHandles.length === 0 || path === null) {
      return Number.POSITIVE_INFINITY;
    }
    const endpoint = path.getPointAtLength(path.getTotalLength());
    const screenEndpoint = new DOMPoint(endpoint.x, endpoint.y).matrixTransform(path.getScreenCTM() ?? new DOMMatrix());
    return Math.min(...targetHandles.map((handle) => {
      const rect = handle.getBoundingClientRect();
      return Math.hypot(screenEndpoint.x - (rect.left + rect.width / 2), screenEndpoint.y - (rect.top + rect.height / 2));
    }));
  }, incomingEdgeId);
  // The horizontal canvas attaches incoming connections to the target's live facing handle,
  // rather than the card centre. A larger gap means node and edge geometry diverged during the
  // live update.
  expect(connectorDistance).toBeLessThan(5);
});

test("cards that survive a live edit re-flow with the new layout instead of stacking under new cards", async ({ page }) => {
  const workflowFile = path.join(root, ".codehq", "workflows", "upload-assets.json");
  const full = JSON.parse(await fsp.readFile(workflowFile, "utf-8")) as MinimalWorkflowFile;
  const keep = new Set(["receive-upload", "validate-file"]);
  const small = structuredClone(full);
  small.steps = small.steps.filter((step) => keep.has(step.id));
  small.connections = small.connections.filter((connection) => keep.has(connection.from) && keep.has(connection.to));
  await fsp.writeFile(workflowFile, `${JSON.stringify(small, null, 2)}\n`, "utf-8");

  await page.goto(server.url);
  await page.getByRole("button", { name: /^Workflows:/ }).click();
  await page.getByRole("button", { name: /Upload Reference Asset/ }).first().click();
  await expect(page.locator(".react-flow__node")).toHaveCount(2, { timeout: 10_000 });

  await fsp.writeFile(workflowFile, `${JSON.stringify(full, null, 2)}\n`, "utf-8");
  await expect(page.locator(".react-flow__node")).toHaveCount(full.steps.length, { timeout: 10_000 });

  const overlaps = await page.locator(".react-flow__node").evaluateAll((elements) => {
    const boxes = elements.map((element) => ({ id: element.getAttribute("data-id"), rect: element.getBoundingClientRect() }));
    const found: string[] = [];
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i]!.rect;
        const b = boxes[j]!.rect;
        if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) {
          found.push(`${boxes[i]!.id} / ${boxes[j]!.id}`);
        }
      }
    }
    return found;
  });
  expect(overlaps).toEqual([]);
});
