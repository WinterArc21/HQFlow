/**
 * THE SECOND CORE PROMISE (contract §7.1): when a workflow file goes from valid to invalid on
 * disk, the board keeps showing the last valid version (marked stale), and a diagnostics
 * banner explains why — proven end to end through the real server and a real page, not just
 * at the store-unit-test level.
 *
 * Isolation: owns port 4502 (PORTS.invalidPreservesBoard) and a private temp copy of
 * the test project, created in `beforeAll` and removed in `afterAll`.
 */
import { promises as fsp } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { createTempFixtureCopy, removeTempDir } from "./helpers/fixture";
import { PORTS } from "./helpers/paths";
import { startCodeHQServer, type ManagedServer } from "./helpers/server";

let root: string;
let server: ManagedServer;

test.beforeAll(async () => {
  root = await createTempFixtureCopy("invalid-preserves-board");
  server = await startCodeHQServer(root, PORTS.invalidPreservesBoard);
});

test.afterAll(async () => {
  await server.stop();
  await removeTempDir(root);
});

test("a truncated write keeps the board on screen and surfaces diagnostics, then clears on repair", async ({ page }) => {
  await page.goto(server.url);
  await page.locator("[data-step-node]").first().waitFor({ state: "visible", timeout: 15_000 });
  await expect(page.locator("[data-step-node]")).toHaveCount(11);
  await expect(page.locator('[data-step-node="receive-request"]')).toContainText("Receive Request");

  const workflowFile = path.join(root, ".codehq", "workflows", "generate-video.json");
  const validContents = await fsp.readFile(workflowFile, "utf-8");

  // Simulate an agent's partial write: truncate mid-object so the file is syntactically
  // invalid JSON.
  const truncated = validContents.slice(0, Math.floor(validContents.length / 2));
  await fsp.writeFile(workflowFile, truncated, "utf-8");

  const banner = page.getByRole("alert").filter({ hasText: "Workflow update needs attention" });
  await expect(banner).toBeVisible({ timeout: 10_000 });
  await expect(banner).toContainText("Failed to parse JSON");
  await expect(banner).toContainText("last valid version is still being displayed");

  // The board itself is untouched: same 7 work steps plus 4 outcomes, same content, nothing blanked out.
  await expect(page.locator("[data-step-node]")).toHaveCount(11);
  await expect(page.locator('[data-step-node="receive-request"]')).toContainText("Receive Request");

  // Opening diagnostics from the banner shows the real, actionable error text — not a dead
  // button (contract §12) and not a generic message: the exact JSON parse failure, its file,
  // and its repair hint all come from the real diagnostics.json written by the core loader.
  await page.getByRole("button", { name: "Open diagnostics" }).click();
  const panel = page.getByRole("dialog", { name: "Diagnostics" });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(".codehq/workflows/generate-video.json");
  await expect(panel).toContainText("Failed to parse JSON");
  await expect(panel).toContainText("The file may have been saved while an agent was still writing it.");
  await expect(panel.getByText("Error", { exact: true })).toBeVisible();

  // Escape closes the panel without touching the board underneath.
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(page.locator("[data-step-node]")).toHaveCount(11);

  // The stale state is surfaced on the affected workflow's navigator entry too.
  const navigatorItem = page.locator("button[data-workflow-item]").filter({ hasText: "Generate Video Prompt" });
  await expect(navigatorItem).toContainText("Stale");

  // Repair: write the original, valid content back.
  await fsp.writeFile(workflowFile, validContents, "utf-8");

  await expect(banner).toBeHidden({ timeout: 10_000 });
  await expect(navigatorItem).not.toContainText("Stale");
  await expect(page.locator("[data-step-node]")).toHaveCount(11);
});
