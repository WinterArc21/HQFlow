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
        const head = group.querySelector("circle:last-child")!.getBoundingClientRect();
        const toScreen = path.getScreenCTM() ?? new DOMMatrix();
        const length = path.getTotalLength();
        let nearest = 0;
        let distance = Infinity;
        for (let sample = 0; sample <= 100; sample += 1) {
          const { x: pathX, y: pathY } = path.getPointAtLength(length * sample / 100);
          const point = new DOMPoint(pathX, pathY).matrixTransform(toScreen);
          const next = Math.hypot(point.x - (head.x + head.width / 2), point.y - (head.y + head.height / 2));
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

test("keeps stepped corners rounded on both sides of the port-lead gap boundary", async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  try {
    // These saved positions put the facing ports just below/above the two 28-unit leads,
    // then farther apart. Only the gap changes; the connection and its vertical span do not.
    for (const x of [473, 474.6, 478, 540]) {
      const saved = await request.put(`${server.url}/api/workflows/generate-video/layout`, {
        data: { nodePositions: { "receive-request": { x: 100, y: 100 }, "validate-request": { x, y: 280 } } },
      });
      expect(saved.ok()).toBe(true);
      await page.goto(server.url);
      await waitForBoot(page);
      const edge = page.locator('.react-flow__edge[data-id="receive-request->validate-request#0"] path.react-flow__edge-path');
      await expect.poll(() => edge.evaluate((element) => {
        const path = element as SVGPathElement;
        const start = path.getPointAtLength(0);
        const end = path.getPointAtLength(path.getTotalLength());
        const commands = [...path.getAttribute("d")!.matchAll(/([MLQ])([^MLQ]+)/g)].map((match) => ({
          kind: match[1],
          values: match[2]!.trim().split(/[\s,]+/).map(Number),
        }));
        const radii = commands.flatMap((command, index) => command.kind === "Q"
          ? [Math.hypot(command.values[0]! - commands[index - 1]!.values.at(-2)!, command.values[1]! - commands[index - 1]!.values.at(-1)!)]
          : []);
        // A two-bend route has half the horizontal gap on either side of its vertical run.
        // Each corner can use half that run, up to the designed 16-unit radius.
        const expected = Math.min(16, Math.abs(end.x - start.x) / 4, Math.abs(end.y - start.y) / 2);
        return radii.length === 2 && radii.every((radius) => Math.abs(radius - expected) < 0.01);
      })).toBe(true);
    }
  } finally {
    await request.delete(`${server.url}/api/workflows/generate-video/layout`);
  }
});

for (const view of ["Wrap", "Flow", "Line"] as const) {
  for (const target of ["outcome-quota-exceeded", "check-quota"] as const) {
    test(`keeps trace highlighting stable while dragging ${target} in ${view} view`, async ({ page }) => {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(server.url);
      await waitForBoot(page);
      await selectWorkflowByName(page, "Generate Video Prompt");
      await page.getByRole("button", { name: `${view} view`, exact: true }).click();
      await resetCanvasLayout(page);

      const dragged = page.locator(`[data-step-node="${target}"]`);
      const start = await dragged.boundingBox();
      const validation = await page.locator('[data-step-node="validate-request"]').boundingBox();
      const entry = await page.locator('[data-step-node="receive-request"]').boundingBox();
      expect(start).not.toBeNull();
      expect(validation).not.toBeNull();
      expect(entry).not.toBeNull();
      await page.mouse.move(start!.x + start!.width / 2, start!.y + start!.height / 2);
      await expect(page.locator('[data-step-node="outcome-invalid-request"]')).toHaveCSS("opacity", "0.35");

      // Sample every painted frame: checking only after each move misses a split-second flash.
      const monitor = await page.evaluateHandle(() => {
        const appearance = () => Array.from(document.querySelectorAll("[data-step-node], .react-flow__edge-path"), (element) => {
          const style = getComputedStyle(element);
          return `${style.opacity}:${style.strokeWidth}`;
        }).join("|");
        const before = appearance();
        const result = { frames: 0, changed: 0 };
        let frame = 0;
        const sample = (): void => {
          result.frames += 1;
          if (appearance() !== before) result.changed += 1;
          frame = requestAnimationFrame(sample);
        };
        frame = requestAnimationFrame(sample);
        return { stop: () => { cancelAnimationFrame(frame); return result; } };
      });
      await page.mouse.down();
      // Cross a card, its edge, another card, and empty canvas without releasing the button.
      for (const point of [validation!, entry!, { x: entry!.x, y: entry!.y + entry!.height + 50, width: entry!.width, height: 0 }]) {
        await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2);
        await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      }
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const result = await monitor.evaluate((monitor) => monitor.stop());
      await monitor.dispose();
      await page.mouse.up();
      expect(result.frames).toBeGreaterThan(0);
      expect(result.changed).toBe(0);
      const end = await dragged.boundingBox();
      expect(Math.hypot(end!.x - start!.x, end!.y - start!.y)).toBeGreaterThan(50);

      // Hover must work again after release, and leaving the graph must clear all dimming.
      await page.locator('[data-step-node="receive-request"]').hover();
      await expect(page.locator('[data-step-node="validate-request"]')).toHaveCSS("opacity", "1");
      await expect(page.locator('[data-step-node="outcome-quota-exceeded"]')).toHaveCSS("opacity", "0.35");
      await page.mouse.move(5, 5);
      await expect.poll(() => page.locator("[data-step-node]").evaluateAll((nodes) => (
        nodes.every((node) => getComputedStyle(node).opacity === "1")
      ))).toBe(true);
    });
  }
}
