/**
 * Two independent repository states, each with its own server/port/temp-dir (PORTS.uninitialized
 * / PORTS.empty) so the two `describe` blocks below are safe to run concurrently with the rest
 * of the suite under `fullyParallel`.
 */
import { promises as fsp } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { createEmptyTempDir, createTempFixtureCopy, removeTempDir } from "./helpers/fixture";
import { PORTS } from "./helpers/paths";
import { startCodeHQServer, type ManagedServer } from "./helpers/server";

test.describe("no .codehq directory at all", () => {
  let root: string;
  let server: ManagedServer;

  test.beforeAll(async () => {
    root = await createEmptyTempDir("uninitialized");
    server = await startCodeHQServer(root, PORTS.uninitialized);
  });

  test.afterAll(async () => {
    await server.stop();
    await removeTempDir(root);
  });

  test("renders the uninitialized state with the init command", async ({ page }) => {
    await page.goto(server.url);
    await expect(page.getByText("HQFlow isn't set up in this repository yet")).toBeVisible();
    await expect(page.locator("code").filter({ hasText: "npx hqflow init" })).toBeVisible();
  });
});

test.describe("initialized but no workflow files", () => {
  test.describe.configure({ mode: "serial" });
  let root: string;
  let server: ManagedServer;

  test.beforeAll(async () => {
    root = await createTempFixtureCopy("empty");
    await fsp.rm(path.join(root, ".codehq", "workflows", "generate-video.json"), { force: true });
    await fsp.rm(path.join(root, ".codehq", "workflows", "upload-assets.json"), { force: true });
    server = await startCodeHQServer(root, PORTS.empty);
  });

  test.afterAll(async () => {
    await server.stop();
    await removeTempDir(root);
  });

  test("renders the guided empty state with its copy-prompt action", async ({ page }) => {
    await page.goto(server.url);
    await expect(page.getByText("Map your repository")).toBeVisible();
    await expect(page.getByRole("button", { name: "Map my repository" })).toBeVisible();
  });

  test("shows overview cards live, then opens a workflow when its detail file arrives", async ({ page }) => {
    await page.goto(server.url);
    await fsp.writeFile(
      path.join(root, ".codehq", "repository-map.json"),
      JSON.stringify({
        schemaVersion: "0.1",
        workflows: [
          { id: "checkout", name: "Checkout", purpose: "Turns a cart into a confirmed order." },
          { id: "fulfilment", name: "Fulfilment", purpose: "Ships paid orders." },
        ],
        connections: [{
          from: "checkout",
          to: "fulfilment",
          label: "paid order",
          sources: [{ file: "package.json" }],
        }],
      }, null, 2),
    );

    await expect(page.getByRole("heading", { name: "Repository Overview" })).toBeVisible();
    await expect(page.getByText("0 of 2 workflows mapped")).toBeVisible();
    const checkoutCard = page.locator('[data-step-node="checkout"]');
    await expect(checkoutCard).toBeVisible();
    await expect(page.locator('[data-step-node="fulfilment"]')).toBeVisible();
    await expect(page.locator('.react-flow__edge[data-id="repository-handoff-0"]')).toBeVisible();

    const cardBox = await checkoutCard.boundingBox();
    expect(cardBox).not.toBeNull();
    await page.mouse.move(cardBox!.x + cardBox!.width / 2, cardBox!.y + cardBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(cardBox!.x + cardBox!.width / 2 + 80, cardBox!.y + cardBox!.height / 2 + 50, { steps: 4 });
    await page.mouse.up();

    const bendHandle = page.getByRole("button", { name: "Bend edge repository-handoff-0" });
    const bendBox = await bendHandle.boundingBox();
    expect(bendBox).not.toBeNull();
    await page.mouse.move(bendBox!.x + bendBox!.width / 2, bendBox!.y + bendBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(bendBox!.x + bendBox!.width / 2 + 45, bendBox!.y + bendBox!.height / 2 + 45, { steps: 4 });
    await page.mouse.up();

    await expect.poll(async () => {
      const raw = await fsp.readFile(path.join(root, ".codehq", ".runtime", "layout.json"), "utf-8").catch(() => "{}");
      return JSON.parse(raw) as unknown;
    }).toMatchObject({
      workflows: {
        "__repository-map__": {
          nodePositions: { checkout: { x: expect.any(Number), y: expect.any(Number) } },
          edgeBends: {
            "repository-handoff-0": { point: { x: expect.any(Number), y: expect.any(Number) } },
          },
        },
      },
    });

    await fsp.writeFile(
      path.join(root, ".codehq", "workflows", "checkout.json"),
      JSON.stringify({
        schemaVersion: "0.1",
        id: "checkout",
        name: "Checkout",
        purpose: "Turns a cart into a confirmed order.",
        steps: [{ id: "receive-cart", name: "Receive cart", purpose: "Accepts the cart.", category: "entry" }],
        connections: [],
      }, null, 2),
    );

    await expect(page.getByText("1 of 2 workflows mapped")).toBeVisible();
    await checkoutCard.click();
    await expect(page.getByRole("heading", { name: "Checkout" })).toBeVisible();
    await expect(page.locator('[data-step-node="receive-cart"]')).toBeVisible();
  });
});
