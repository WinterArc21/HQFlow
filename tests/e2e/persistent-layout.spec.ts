/** Uses a private project copy because this spec writes repository-local runtime state. */
import { promises as fsp } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { waitForBoot } from "./helpers/app";
import { createTempFixtureCopy, removeTempDir } from "./helpers/fixture";
import { PORTS } from "./helpers/paths";
import { startCodeHQServer, type ManagedServer } from "./helpers/server";

const WORKFLOW_ID = "generate-video";
const NODE_ID = "receive-request";
const EDGE_ID = "receive-request->validate-request#0";
let root: string;
let server: ManagedServer;

async function storedLayout(): Promise<Record<string, unknown> | undefined> {
  const raw = await fsp.readFile(path.join(root, ".codehq", ".runtime", "layout.json"), "utf-8").catch(() => null);
  if (raw === null) return undefined;
  const persisted = JSON.parse(raw) as { workflows?: Record<string, Record<string, unknown>> };
  return persisted.workflows?.[WORKFLOW_ID];
}

test.beforeAll(async () => {
  root = await createTempFixtureCopy("persistent-layout");
  server = await startCodeHQServer(root, PORTS.persistentLayout);
});

test.afterAll(async () => {
  await server.stop();
  await removeTempDir(root);
});

test("persists geometry across restart while resetting temporary view state", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(server.url);
  await waitForBoot(page);

  const node = page.locator(`.react-flow__node[data-id="${NODE_ID}"]`);
  const edgePath = page.locator(`.react-flow__edge[data-id="${EDGE_ID}"] path.react-flow__edge-path`);
  const viewport = page.locator(".react-flow__viewport");
  const initialNodeTransform = await node.evaluate((element) => (element as HTMLElement).style.transform);
  const initialEdgePath = await edgePath.getAttribute("d");
  const initialViewportTransform = await viewport.getAttribute("style");


  const nodeBox = await node.boundingBox();
  expect(nodeBox).not.toBeNull();
  await page.mouse.move(nodeBox!.x + nodeBox!.width / 2, nodeBox!.y + nodeBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(nodeBox!.x + nodeBox!.width / 2 + 110, nodeBox!.y + nodeBox!.height / 2 + 70, { steps: 5 });
  await page.mouse.up();

  await expect(page.getByRole("button", { name: /^Bend edge / })).toHaveCount(0);

  const paneBox = await page.locator(".react-flow__pane").boundingBox();
  expect(paneBox).not.toBeNull();
  await page.mouse.move(paneBox!.x + paneBox!.width - 40, paneBox!.y + paneBox!.height - 40);
  await page.mouse.down();
  await page.mouse.move(paneBox!.x + paneBox!.width - 105, paneBox!.y + paneBox!.height - 5, { steps: 4 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Zoom in" }).click();

  await expect.poll(storedLayout).toMatchObject({
    nodePositions: { [NODE_ID]: { x: expect.any(Number), y: expect.any(Number) } },
  });
  expect(Object.keys((await storedLayout()) ?? {}).sort()).toEqual(["nodePositions"]);

  const persistedNodeTransform = await node.evaluate((element) => (element as HTMLElement).style.transform);
  const persistedEdgePath = await edgePath.getAttribute("d");
  const persistedViewportTransform = await viewport.getAttribute("style");
  expect(persistedNodeTransform).not.toBe(initialNodeTransform);
  expect(persistedEdgePath).not.toBe(initialEdgePath);
  expect(persistedViewportTransform).not.toBe(initialViewportTransform);

  await page.evaluate(() => localStorage.clear());
  await server.stop();
  server = await startCodeHQServer(root, PORTS.persistentLayoutRestart);
  await page.goto(server.url);
  await node.waitFor({ state: "visible", timeout: 15_000 });
  await expect.poll(() => node.evaluate((element) => (element as HTMLElement).style.transform)).toBe(persistedNodeTransform);
  await expect(edgePath).toHaveAttribute("d", persistedEdgePath!);
  await expect(viewport).toHaveAttribute("style", initialViewportTransform!);

  await page.getByRole("button", { name: "Reset layout" }).click();
  await expect.poll(() => node.evaluate((element) => (element as HTMLElement).style.transform)).toBe(initialNodeTransform);
  await expect(edgePath).toHaveAttribute("d", initialEdgePath!);
  await expect(viewport).toHaveAttribute("style", initialViewportTransform!);
  await expect.poll(storedLayout).toBeUndefined();
});
