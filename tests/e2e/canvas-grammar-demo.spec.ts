/**
 * Uses a disposable copy of MotionA only as the host repository, then injects the explicitly
 * synthetic e2e fixture. The demo is never committed under examples/motiona and makes no claim
 * about that example's source behavior.
 */
import { promises as fsp } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { selectWorkflowByName, waitForBoot } from "./helpers/app";
import { createTempFixtureCopy, removeTempDir } from "./helpers/fixture";
import { PORTS, REPO_ROOT } from "./helpers/paths";
import { startCodeHQServer, type ManagedServer } from "./helpers/server";

const ARTIFACT_DIR = path.join(REPO_ROOT, ".amp", "in", "artifacts");
const DEMO_SOURCE = path.join(REPO_ROOT, "tests", "e2e", "fixtures", "canvas-grammar-demo.json");
let root: string;
let server: ManagedServer;

async function setTheme(page: Page, theme: "dark" | "light"): Promise<void> {
  const current = await page.locator("html").getAttribute("data-theme");
  if (current !== theme) {
    await page.getByRole("button", { name: `Switch to ${theme} theme` }).click();
  }
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

async function capture(page: Page, workflow: string, slug: string, theme: "dark" | "light"): Promise<void> {
  await selectWorkflowByName(page, workflow);
  await waitForBoot(page);
  await setTheme(page, theme);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, `${slug}-${theme}-1440x900.png`), animations: "disabled" });
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
    const handle = document.querySelector<HTMLElement>(
      `[data-nodeid="${nodeId}"][data-handleid="${handleId}"]`,
    );
    if (path === null || handle === null) {
      return Number.POSITIVE_INFINITY;
    }
    const point = path.getPointAtLength(endpoint === "source" ? 0 : path.getTotalLength());
    const screenPoint = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM() ?? new DOMMatrix());
    const rect = handle.getBoundingClientRect();
    return Math.hypot(screenPoint.x - (rect.left + rect.width / 2), screenPoint.y - (rect.top + rect.height / 2));
  }, { edgeId, nodeId, handleId, endpoint });
}

test.beforeAll(async () => {
  root = await createTempFixtureCopy("canvas-grammar");
  await fsp.copyFile(DEMO_SOURCE, path.join(root, ".codehq", "workflows", "canvas-grammar-demo.json"));
  await fsp.mkdir(ARTIFACT_DIR, { recursive: true });
  server = await startCodeHQServer(root, PORTS.canvasGrammar);
});

test.afterAll(async () => {
  await server.stop();
  await removeTempDir(root);
});

test("renders the synthetic retry, return, async, fan-out/fan-in, and outcomes without overlaps", async ({ page }) => {
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
  await expect(retry).toHaveCSS("stroke-dasharray", /8px, 6px/);
  await expect(returned).toHaveCSS("stroke-dasharray", /8px, 6px/);
  await expect(asyncHandoff).toHaveCSS("stroke-dasharray", /1px, 6px/);
  expect(await retry.getAttribute("d")).not.toBe(await returned.getAttribute("d"));

  await expect(page.locator('[data-step-node="outcome-created"]')).toHaveAttribute("aria-label", /^Success outcome:/);
  await expect(page.locator('[data-step-node="outcome-rejected"]')).toHaveAttribute("aria-label", /^Failure outcome:/);
  await expect(page.locator('[data-step-node="outcome-queued"]')).toHaveAttribute("aria-label", /^Outcome:/);

  const overlaps = await page.locator("[data-step-node]").evaluateAll((nodes) => {
    const entries = nodes.map((node) => ({ id: (node as HTMLElement).dataset.stepNode ?? "?", rect: node.getBoundingClientRect() }));
    return entries.flatMap((left, index) => entries.slice(index + 1).flatMap((right) => {
      const intersects = left.rect.left < right.rect.right && left.rect.right > right.rect.left &&
        left.rect.top < right.rect.bottom && left.rect.bottom > right.rect.top;
      return intersects ? [`${left.id}/${right.id}`] : [];
    }));
  });
  expect(overlaps).toEqual([]);
});

test("keeps a connection attached while its card is freely dragged", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(server.url);
  await waitForBoot(page);
  await selectWorkflowByName(page, "Generate Video Prompt");

  const node = page.locator('[data-step-node="validate-request"]');
  const edge = page.locator('.react-flow__edge[data-id^="receive-request->validate-request"] path.react-flow__edge-path');
  const before = await edge.getAttribute("d");
  const box = await node.boundingBox();
  expect(box).not.toBeNull();

  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 120, box!.y + box!.height / 2 + 70, { steps: 12 });
  await page.mouse.up();

  await expect.poll(() => edge.getAttribute("d")).not.toBe(before);
  const endpointDistance = await edge.evaluate((path) => {
    const svgPath = path as SVGPathElement;
    const endpoint = svgPath.getPointAtLength(svgPath.getTotalLength());
    const screenEndpoint = new DOMPoint(endpoint.x, endpoint.y).matrixTransform(svgPath.getScreenCTM() ?? new DOMMatrix());
    const handle = document.querySelector<HTMLElement>('[data-nodeid="validate-request"][data-handleid="in"]');
    if (handle === null) return Number.POSITIVE_INFINITY;
    const rect = handle.getBoundingClientRect();
    return Math.hypot(screenEndpoint.x - (rect.left + rect.width / 2), screenEndpoint.y - (rect.top + rect.height / 2));
  });
  expect(endpointDistance).toBeLessThan(5);
});

test("switches ordinary connections to the closest facing card sides while dragging", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(server.url);
  await waitForBoot(page);
  await selectWorkflowByName(page, "Generate Video Prompt");

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
  await expect.poll(() => edgeEndpointDistance(page, edgeId, sourceId, "out-left", "source")).toBeLessThan(5);
  await expect.poll(() => edgeEndpointDistance(page, edgeId, targetId, "in-right", "target")).toBeLessThan(5);
  await page.mouse.up();

  // Moving B below A should choose the source bottom and target top instead of either horizontal
  // side, using the same dominant-axis rule as the production canvas. Start from a fresh board so
  // the first scenario's deliberately off-mainline card cannot be clipped by the viewport.
  await page.goto(server.url);
  await waitForBoot(page);
  await selectWorkflowByName(page, "Generate Video Prompt");
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
  await expect.poll(() => edgeEndpointDistance(page, edgeId, sourceId, "out-bottom", "source")).toBeLessThan(5);
  await expect.poll(() => edgeEndpointDistance(page, edgeId, targetId, "in-top", "target")).toBeLessThan(5);
  await page.mouse.up();
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
  await expect.poll(() => edgeEndpointDistance(page, "review-created", sourceId, "out-left", "source")).toBeLessThan(5);
  await expect.poll(() => edgeEndpointDistance(page, "review-created", "outcome-created", "in-right", "target")).toBeLessThan(5);
  await page.mouse.up();

  // A fresh board gives the failure outcome its original above-the-line position. Dragging it
  // below the source exercises the opposite semantic band with the vertical cardinal pair.
  await page.goto(server.url);
  await waitForBoot(page);
  await selectWorkflowByName(page, "Canvas Grammar Demo");
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
  await expect.poll(() => edgeEndpointDistance(page, "review-rejected", sourceId, "out-bottom", "source")).toBeLessThan(5);
  await expect.poll(() => edgeEndpointDistance(page, "review-rejected", "outcome-rejected", "in-top", "target")).toBeLessThan(5);
  await page.mouse.up();
});

test("keeps repeated drag updates error-free and deterministic", async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") {
      runtimeErrors.push(`console.error: ${message.text()}`);
    }
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(server.url);
  await waitForBoot(page);
  await selectWorkflowByName(page, "Canvas Grammar Demo");

  const source = page.locator('[data-step-node="review"]');
  const target = page.locator('[data-step-node="outcome-created"]');
  const sourceBox = await source.boundingBox();
  expect(sourceBox).not.toBeNull();

  const moveTarget = async (): Promise<string> => {
    const targetBox = await target.boundingBox();
    expect(targetBox).not.toBeNull();
    await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      sourceBox!.x - targetBox!.width / 2 - 40,
      sourceBox!.y + sourceBox!.height / 2,
      { steps: 12 },
    );
    await page.mouse.up();
    return (await page.locator('.react-flow__edge[data-id="review-created"] path.react-flow__edge-path').getAttribute("d")) ?? "";
  };

  const firstPath = await moveTarget();
  expect(runtimeErrors).toEqual([]);

  // Return to the same deterministic initial state, then replay the same pointer path. The route
  // string must match exactly; this catches order-dependent candidate selection without a timing
  // or performance assertion.
  await page.goto(server.url);
  await waitForBoot(page);
  await selectWorkflowByName(page, "Canvas Grammar Demo");
  const replayPath = await moveTarget();
  expect(replayPath).toBe(firstPath);
  expect(runtimeErrors).toEqual([]);
});

test("captures deterministic dark and light review screenshots", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(server.url);
  await waitForBoot(page);

  for (const theme of ["dark", "light"] as const) {
    await capture(page, "Generate Video Prompt", "generate-video", theme);
    await capture(page, "Upload Reference Asset", "upload-assets", theme);
    await capture(page, "Canvas Grammar Demo", "canvas-grammar-demo", theme);
  }
});
