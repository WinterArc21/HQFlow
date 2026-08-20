/**
 * A dedicated private server + temp `.codehq` because this spec writes to 
 * `.codehq/.runtime/layout.json` — the shared read-only fixture server must 
 * never see a mutation like the other read-only specs share.
 */
import { promises as fsp } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { selectWorkflowByName, waitForBoot } from "./helpers/app";
import { createTempFixtureCopy, removeTempDir } from "./helpers/fixture";
import { PORTS } from "./helpers/paths";
import { startCodeHQServer, type ManagedServer } from "./helpers/server";

let root: string;
let server: ManagedServer;

// Both tests share one dedicated port; serial mode keeps concurrent workers from racing to bind it.
test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  root = await createTempFixtureCopy("save-layout");
  server = await startCodeHQServer(root, PORTS.saveLayout);
});

test.afterAll(async () => {
  await server.stop();
  await removeTempDir(root);
});

async function dragNode(page: import("@playwright/test").Page, stepId: string, dx: number, dy: number): Promise<void> {
  const node = page.locator(`[data-step-node="${stepId}"]`);
  const box = await node.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + dx, box!.y + box!.height / 2 + dy, { steps: 12 });
  await page.mouse.up();
}

test("a saved layout survives reload; without saving, it does not", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(server.url);
  await waitForBoot(page);
  await selectWorkflowByName(page, "Generate Video Prompt");

  const node = page.locator('[data-step-node="validate-request"]');
  const originalBox = await node.boundingBox();
  expect(originalBox).not.toBeNull();

  await dragNode(page, "validate-request", 140, 90);
  const draggedBox = await node.boundingBox();
  expect(draggedBox!.x).not.toBeCloseTo(originalBox!.x, 0);

  await page.getByRole("button", { name: "Save layout" }).click();
  await expect(page.getByRole("alert")).not.toBeVisible();

  await page.reload();
  await waitForBoot(page);
  await selectWorkflowByName(page, "Generate Video Prompt");
  const reloadedBox = await node.boundingBox();
  expect(reloadedBox).not.toBeNull();
  expect(Math.abs(reloadedBox!.x - draggedBox!.x)).toBeLessThan(2);
  expect(Math.abs(reloadedBox!.y - draggedBox!.y)).toBeLessThan(2);

  const layoutFile = JSON.parse(
    await fsp.readFile(path.join(root, ".codehq", ".runtime", "layout.json"), "utf-8"),
  ) as Record<string, Record<string, { x: number; y: number }>>;
  expect(layoutFile["generate-video"]?.["validate-request"]).toBeDefined();
});

test("Reset layout only changes the current view, not the saved file", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(server.url);
  await waitForBoot(page);
  await selectWorkflowByName(page, "Upload Reference Asset");

  const node = page.locator('[data-step-node="validate-file"]');

  await dragNode(page, "validate-file", 100, 60);
  const savedBox = await node.boundingBox();
  expect(savedBox).not.toBeNull();
  await page.getByRole("button", { name: "Save layout" }).click();
  await expect(page.getByRole("alert")).not.toBeVisible();

  await dragNode(page, "validate-file", -60, 40);
  const draggedAgainBox = await node.boundingBox();
  expect(draggedAgainBox!.x).not.toBeCloseTo(savedBox!.x, 0);

  await page.getByRole("button", { name: "Reset layout" }).click();
  await expect.poll(async () => (await node.boundingBox())?.x).not.toBeCloseTo(draggedAgainBox!.x, 0);

  await page.reload();
  await waitForBoot(page);
  await selectWorkflowByName(page, "Upload Reference Asset");
  const reloadedBox = await node.boundingBox();
  expect(reloadedBox).not.toBeNull();
  expect(Math.abs(reloadedBox!.x - savedBox!.x)).toBeLessThan(2);
});
