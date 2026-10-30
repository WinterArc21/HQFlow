/**
 * Uses a disposable copy of the test project as the host repository, then injects the
 * synthetic canvas fixture.
 */
import { promises as fsp } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { selectWorkflowByName, waitForBoot } from "./helpers/app";
import { createTempFixtureCopy, removeTempDir } from "./helpers/fixture";
import { PORTS, REPO_ROOT } from "./helpers/paths";
import { startCodeHQServer, type ManagedServer } from "./helpers/server";

const DEMO_SOURCE = path.join(REPO_ROOT, "tests", "e2e", "fixtures", "canvas-grammar-demo.json");
// React Flow can place an endpoint just outside the handle box because the card border and SVG
// use separate coordinate spaces. Keep the allowance smaller than one unscaled handle radius.
const EDGE_ENDPOINT_TOLERANCE_PX = 2;
let root: string;
let server: ManagedServer;

async function resetCanvasLayout(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Reset layout" }).click();
}

async function edgeEndpointDistance(
  page: Page,
  edgeId: string,
  nodeId: string,
  handleId: string,
  endpoint: "source" | "target",
): Promise<number> {
  return page.evaluate(({ edgeId, nodeId, handleId, endpoint }) => {
    const path = document.querySelector<SVGPathElement>(
      `.react-flow__edge[data-id="${edgeId}"] path.react-flow__edge-path`,
    );
    // A side shared by an arrival and a departure moves both to its split ports (`id@1`, `id@2`),
    // which are still on the same side.
    const handles = [...document.querySelectorAll<HTMLElement>(
      `[data-nodeid="${nodeId}"][data-handleid="${handleId}"], [data-nodeid="${nodeId}"][data-handleid^="${handleId}@"]`,
    )];
    if (path === null || handles.length === 0) {
      return Number.POSITIVE_INFINITY;
    }
    const point = path.getPointAtLength(endpoint === "source" ? 0 : path.getTotalLength());
    const screenPoint = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM() ?? new DOMMatrix());
    return Math.min(...handles.map((handle) => {
      const rect = handle.getBoundingClientRect();
      const dx = Math.max(rect.left - screenPoint.x, 0, screenPoint.x - rect.right);
      const dy = Math.max(rect.top - screenPoint.y, 0, screenPoint.y - rect.bottom);
      return Math.hypot(dx, dy);
    }));
  }, { edgeId, nodeId, handleId, endpoint });
}

// One server on one fixed port serves this whole file, so its tests must share one worker: under
// `fullyParallel`, a second worker would start its own server on the same port, and whichever
// finished first would stop the server out from under the other.
test.describe.configure({ mode: "default" });

test.beforeAll(async () => {
  root = await createTempFixtureCopy("canvas-grammar");
  await fsp.copyFile(DEMO_SOURCE, path.join(root, ".codehq", "workflows", "canvas-grammar-demo.json"));
  server = await startCodeHQServer(root, PORTS.canvasGrammar);
});

test.afterAll(async () => {
  await server.stop();
  await removeTempDir(root);
});

test("renders the synthetic retry, return, async, fan-out/fan-in, and outcomes", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(server.url);
  await waitForBoot(page);
  await selectWorkflowByName(page, "Canvas Grammar Demo");
  await expect(page.locator('[data-step-node="accept-job"]')).toBeVisible();

  for (const label of ["retry ≤3", "re-encode", "handoff", "invalid", "queued"]) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }

  const retry = page.locator('.react-flow__edge[data-id="retry-encode"] path.react-flow__edge-path');
  const returned = page.locator('.react-flow__edge[data-id="review-reencode"] path.react-flow__edge-path');
  const asyncHandoff = page.locator('.react-flow__edge[data-id="review-notify"] path.react-flow__edge-path');
  await expect(asyncHandoff).toBeAttached();
  expect(await retry.getAttribute("d")).not.toBe(await returned.getAttribute("d"));

  await expect(page.locator('[data-step-node="outcome-created"]')).toHaveAttribute("aria-label", /^Success outcome:/);
  await expect(page.locator('[data-step-node="outcome-rejected"]')).toHaveAttribute("aria-label", /^Failure outcome:/);
  await expect(page.locator('[data-step-node="outcome-queued"]')).toHaveAttribute("aria-label", /^Outcome:/);
});

test("switches ordinary connections to the closest facing card sides while dragging", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(server.url);
  await waitForBoot(page);
  await selectWorkflowByName(page, "Generate Video Prompt");
  await resetCanvasLayout(page);

  const edgeId = "receive-request->validate-request#0";
  const sourceId = "receive-request";
  const targetId = "validate-request";
  const source = page.locator(`[data-step-node="${sourceId}"]`);
  const target = page.locator(`[data-step-node="${targetId}"]`);
  const sourceBox = await source.boundingBox();
  const initialTargetBox = await target.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(initialTargetBox).not.toBeNull();

  // Move B from the right of A to the left. Assert before mouse-up to prove the handles switch
  // continuously during the drag rather than only after React Flow commits a final position.
  await page.mouse.move(
    initialTargetBox!.x + initialTargetBox!.width / 2,
    initialTargetBox!.y + initialTargetBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    sourceBox!.x - initialTargetBox!.width / 2 - 80,
    sourceBox!.y + sourceBox!.height / 2,
    { steps: 16 },
  );
  await expect.poll(() => edgeEndpointDistance(page, edgeId, sourceId, "out-left", "source")).toBeLessThan(EDGE_ENDPOINT_TOLERANCE_PX);
  await expect.poll(() => edgeEndpointDistance(page, edgeId, targetId, "in-right", "target")).toBeLessThan(EDGE_ENDPOINT_TOLERANCE_PX);
  await page.mouse.up();

  // Moving B below A should choose the source bottom and target top instead of either horizontal
  // side, using the same dominant-axis rule as the production canvas. Start from a fresh board so
  // the first scenario's deliberately off-mainline card cannot be clipped by the viewport.
  await page.goto(server.url);
  await waitForBoot(page);
  await selectWorkflowByName(page, "Generate Video Prompt");
  await resetCanvasLayout(page);
  const verticalSourceBox = await source.boundingBox();
  const verticalTargetBox = await target.boundingBox();
  expect(verticalSourceBox).not.toBeNull();
  expect(verticalTargetBox).not.toBeNull();
  await page.mouse.move(
    verticalTargetBox!.x + verticalTargetBox!.width / 2,
    verticalTargetBox!.y + verticalTargetBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    verticalSourceBox!.x + verticalSourceBox!.width / 2,
    verticalSourceBox!.y + verticalSourceBox!.height + verticalTargetBox!.height / 2 + 80,
    { steps: 16 },
  );
  await expect.poll(() => edgeEndpointDistance(page, edgeId, sourceId, "out-bottom", "source")).toBeLessThan(EDGE_ENDPOINT_TOLERANCE_PX);
  await expect.poll(() => edgeEndpointDistance(page, edgeId, targetId, "in-top", "target")).toBeLessThan(EDGE_ENDPOINT_TOLERANCE_PX);
  await page.mouse.up();
});

test("keeps outgoing comets along their connections when cards move", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(server.url);
  await waitForBoot(page);
  // Keep software-rendered background shaders out of this animation timing check.
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.getByRole("radio", { name: "Plain", exact: true }).click();
  await page.getByRole("button", { name: "Close appearance" }).click();
  await selectWorkflowByName(page, "Generate Video Prompt");
  await resetCanvasLayout(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });

  for (const nodeId of ["receive-request", "validate-request"]) {
    const card = page.locator(`[data-step-node="${nodeId}"]`);
    await card.hover();
    const comet = page.locator(`[data-edge-source="${nodeId}"] [data-handoff-comet]`).first();
    await expect(comet).toBeAttached();
    const box = await card.boundingBox();
    expect(box).not.toBeNull();
    const x = box!.x + box!.width / 2;
    const y = box!.y + box!.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 5, y + 5, { steps: 2 });

    for (const direction of [1, -1]) {
      const previousPath = await comet.locator("path").getAttribute("d");
      // Put the bead halfway through a run, not at a loop boundary. A second cycle also
      // ensures its delayed tail has started. Check the rendered position after rerouting.
      await comet.evaluate((group) => {
        const head = group.querySelector("circle:last-child")!;
        const animation = head.getAnimations()[0]!;
        const duration = Number(animation.effect!.getTiming().duration);
        animation.currentTime = duration + (duration - 700) * 0.45;
      });
      await page.mouse.move(x + direction * 35, y + direction * 15);
      await expect(comet.locator("path")).not.toHaveAttribute("d", previousPath!);
      const progress = await comet.evaluate((group) => {
        const path = group.querySelector("path")!;
        const head = group.querySelector("circle:last-child")!;
        const matrix = new DOMMatrix(getComputedStyle(head).transform);
        const length = path.getTotalLength();
        let nearest = 0;
        let distance = Infinity;
        for (let sample = 0; sample <= 100; sample += 1) {
          const point = path.getPointAtLength(length * sample / 100);
          const next = Math.hypot(point.x - matrix.e, point.y - matrix.f);
          if (next < distance) {
            distance = next;
            nearest = sample / 100;
          }
        }
        return nearest;
      });
      expect(progress, `${nodeId}, direction ${direction}`).toBeGreaterThan(0.35);
    }
    await page.mouse.up();
  }
});

test("switches outcome connections to facing sides while dragging success and failure outcomes", async ({ page }) => {
  // This demo's semantic outcome bands extend beyond the default 1280px test viewport. Keep the
  // source and target within the real pointer event region so this exercises a drag, not an
  // off-screen mouse coordinate.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(server.url);
  await waitForBoot(page);
  await selectWorkflowByName(page, "Canvas Grammar Demo");
  await resetCanvasLayout(page);

  const sourceId = "review";
  const source = page.locator("[data-step-node=\"" + sourceId + "\"]");
  const successOutcome = page.locator("[data-step-node=\"outcome-created\"]");
  const sourceBox = await source.boundingBox();
  const successBox = await successOutcome.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(successBox).not.toBeNull();

  // Move the success outcome left of its source. The edge must switch from the semantic
  // bottom/top route to the facing left/right cardinal pair while the drag is still active.
  await page.mouse.move(successBox!.x + successBox!.width / 2, successBox!.y + successBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    sourceBox!.x - successBox!.width / 2 - 440,
    sourceBox!.y + sourceBox!.height / 2,
    { steps: 16 },
  );
  await expect.poll(() => edgeEndpointDistance(page, "review-created", sourceId, "out-left", "source")).toBeLessThan(EDGE_ENDPOINT_TOLERANCE_PX);
  await expect.poll(() => edgeEndpointDistance(page, "review-created", "outcome-created", "in-right", "target")).toBeLessThan(EDGE_ENDPOINT_TOLERANCE_PX);
  await page.mouse.up();

  // A fresh board gives the failure outcome its original above-the-line position. Dragging it
  // below the source exercises the opposite semantic band with the vertical cardinal pair.
  await page.goto(server.url);
  await waitForBoot(page);
  await selectWorkflowByName(page, "Canvas Grammar Demo");
  await resetCanvasLayout(page);
  const failureOutcome = page.locator("[data-step-node=\"outcome-rejected\"]");
  const verticalSourceBox = await source.boundingBox();
  const failureBox = await failureOutcome.boundingBox();
  expect(verticalSourceBox).not.toBeNull();
  expect(failureBox).not.toBeNull();

  await page.mouse.move(failureBox!.x + failureBox!.width / 2, failureBox!.y + failureBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    verticalSourceBox!.x + verticalSourceBox!.width / 2,
    verticalSourceBox!.y + verticalSourceBox!.height + failureBox!.height / 2 + 80,
    { steps: 16 },
  );
  await expect.poll(() => edgeEndpointDistance(page, "review-rejected", sourceId, "out-bottom", "source")).toBeLessThan(EDGE_ENDPOINT_TOLERANCE_PX);
  await expect.poll(() => edgeEndpointDistance(page, "review-rejected", "outcome-rejected", "in-top", "target")).toBeLessThan(EDGE_ENDPOINT_TOLERANCE_PX);
  await page.mouse.up();
});
