import { expect, test, type Page } from "@playwright/test";

const WORKFLOW_ID = "generate-video";
const NODE_ID = "receive-request";
const EDGE_ID = "receive-request->validate-request#0";

async function storedLayout(page: Page): Promise<Record<string, unknown> | undefined> {
  return page.evaluate((workflowId) => {
    const raw = localStorage.getItem("codehq.ui");
    if (raw === null) return undefined;
    const persisted = JSON.parse(raw) as { state?: { canvasLayouts?: Record<string, Record<string, unknown>> } };
    return persisted.state?.canvasLayouts?.[workflowId];
  }, WORKFLOW_ID);
}

test("persists canvas visuals across reload and resets to the generated layout", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.locator("[data-step-node]").first().waitFor({ state: "visible", timeout: 15_000 });

  const node = page.locator(`.react-flow__node[data-id="${NODE_ID}"]`);
  const edgePath = page.locator(`.react-flow__edge[data-id="${EDGE_ID}"] path.react-flow__edge-path`);
  const viewport = page.locator(".react-flow__viewport");
  const initialNodeTransform = await node.getAttribute("style");
  const initialEdgePath = await edgePath.getAttribute("d");
  const initialViewportTransform = await viewport.getAttribute("style");

  await page.getByRole("button", { name: "Expand Receive Request to show code details" }).click();
  await expect.poll(() => storedLayout(page)).toMatchObject({ expandedStepIds: { [NODE_ID]: true } });
  await expect(page.getByRole("button", { name: "Collapse Receive Request" })).toBeVisible();

  const nodeBox = await node.boundingBox();
  expect(nodeBox).not.toBeNull();
  await page.mouse.move(nodeBox!.x + nodeBox!.width / 2, nodeBox!.y + nodeBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(nodeBox!.x + nodeBox!.width / 2 + 110, nodeBox!.y + nodeBox!.height / 2 + 70, { steps: 5 });
  await page.mouse.up();

  const bendHandle = page.getByRole("button", { name: `Bend edge ${EDGE_ID}` });
  const bendBox = await bendHandle.boundingBox();
  expect(bendBox).not.toBeNull();
  await page.mouse.move(bendBox!.x + bendBox!.width / 2, bendBox!.y + bendBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(bendBox!.x + bendBox!.width / 2 + 45, bendBox!.y + bendBox!.height / 2 + 55, { steps: 4 });
  await page.mouse.up();

  const paneBox = await page.locator(".react-flow__pane").boundingBox();
  expect(paneBox).not.toBeNull();
  await page.mouse.move(paneBox!.x + paneBox!.width - 40, paneBox!.y + paneBox!.height - 40);
  await page.mouse.down();
  await page.mouse.move(paneBox!.x + paneBox!.width - 105, paneBox!.y + paneBox!.height - 5, { steps: 4 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Zoom in" }).click();

  await expect.poll(() => storedLayout(page)).toMatchObject({
    nodePositions: { [NODE_ID]: { x: expect.any(Number), y: expect.any(Number) } },
    edgeBends: { [EDGE_ID]: { point: { x: expect.any(Number), y: expect.any(Number) }, snap: null } },
    viewport: { x: expect.any(Number), y: expect.any(Number), zoom: expect.any(Number) },
    expandedStepIds: { [NODE_ID]: true },
  });

  const persistedNodeTransform = await node.getAttribute("style");
  const persistedEdgePath = await edgePath.getAttribute("d");
  const persistedViewportTransform = await viewport.getAttribute("style");
  const persistedLayout = await storedLayout(page) as {
    edgeBends: Record<string, { point: { x: number; y: number }; snap: null }>;
  };
  const persistedBend = persistedLayout.edgeBends[EDGE_ID]!;
  expect(persistedNodeTransform).not.toBe(initialNodeTransform);
  expect(persistedEdgePath).not.toBe(initialEdgePath);
  expect(persistedViewportTransform).not.toBe(initialViewportTransform);

  await page.reload();
  await node.waitFor({ state: "visible", timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Collapse Receive Request" })).toBeVisible();
  await expect(node).toHaveAttribute("style", persistedNodeTransform!);
  await expect.poll(async () => (await storedLayout(page) as typeof persistedLayout).edgeBends[EDGE_ID]).toEqual(persistedBend);
  await expect.poll(async () => (await edgePath.getAttribute("d")) ?? "").toContain(`${persistedBend.point.x},${persistedBend.point.y}`);
  await expect(viewport).toHaveAttribute("style", persistedViewportTransform!);

  await page.getByRole("button", { name: "Reset layout" }).click();
  await expect(page.getByRole("button", { name: "Expand Receive Request to show code details" })).toBeVisible();
  await expect(node).toHaveAttribute("style", initialNodeTransform!);
  await expect(edgePath).toHaveAttribute("d", initialEdgePath!);
  await expect(viewport).toHaveAttribute("style", initialViewportTransform!);
  await expect.poll(() => storedLayout(page)).toBeUndefined();
});
