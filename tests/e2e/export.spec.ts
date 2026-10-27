/**
 * End-to-end export test: clicks the "Export canvas" button in the running app, captures the
 * downloaded HTML file, opens it directly from disk (file:// — no server), and asserts that
 * the frozen snapshot renders an interactive canvas with step nodes, the export banner, and
 * no "Open in editor" (server-only) buttons.
 */
import { promises as fsp } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { waitForBoot } from "./helpers/app";
import { SHARED_BASE_URL } from "./helpers/paths";

function pngDimensions(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test.describe("Export canvas", () => {
  test("downloads a self-contained HTML snapshot that renders offline", async ({ page, browser }) => {
    // Navigate to the running app and wait for the canvas to render.
    await page.goto(SHARED_BASE_URL);
    await waitForBoot(page);

    // Choose the privacy setting in the export dialog, then download the artifact.
    const downloadPromise = page.waitForEvent("download", { timeout: 15_000 });
    await page.getByRole("button", { name: "Export canvas" }).click();
    await expect(page.getByRole("dialog", { name: /Export/ })).toBeVisible();
    await page.getByRole("radio", { name: /HTML \(interactive\)/i }).check();
    await page.getByRole("radio", { name: /Yes, hide them/i }).check();
    await page.getByRole("button", { name: "Download HTML" }).click();
    const download = await downloadPromise;

    // Save the downloaded file to a temp path.
    const tmpDir = await fsp.mkdtemp(path.join(await import("node:os").then((m) => m.tmpdir()), "codehq-export-"));
    const exportPath = path.join(tmpDir, "export.html");
    await download.saveAs(exportPath);

    const html = await fsp.readFile(exportPath, "utf-8");

    // The file is self-contained: no loaded scripts or stylesheets, and no external URLs.
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link[^>]+href=/i);
    expect(html).not.toMatch(/\b(?:src|href)\s*=\s*["'](?:https?:)?\/\//i);

    // Assert: contains the export banner and payload.
    expect(html).toContain("codehq-export-payload");
    expect(html).toContain('"hideFilePaths":true');
    expect(html).not.toContain("real-source.ts");

    // Open the exported file in a fresh browser context via file:// — no server.
    const offlineContext = await browser.newContext();
    const offlinePage = await offlineContext.newPage();
    await offlinePage.goto(`file://${exportPath}`);

    // The frozen canvas should render step nodes.
    await waitForBoot(offlinePage);

    // The export banner should be visible with the privacy notice.
    await expect(offlinePage.getByText("HQFlow Export")).toBeVisible();
    await expect(offlinePage.getByText("not source code")).toBeVisible();

    // The export viewer reflects the choice made before download and has no post-export toggle.
    await expect(offlinePage.getByText("File paths hidden")).toBeVisible();
    await expect(offlinePage.getByRole("checkbox", { name: /Hide file paths/i })).toHaveCount(0);

    // Click a step node to open the drawer, then verify no "Open in editor" button.
    await offlinePage.locator("[data-step-node]").first().click();
    await expect(offlinePage.getByRole("heading", { name: "Source references" })).toBeVisible({ timeout: 5_000 });

    // The server-only "Open in editor" action must be absent in the export.
    await expect(offlinePage.getByRole("button", { name: "Open in editor" })).toHaveCount(0);

    // The "Export canvas" button (which would point at /api/export/... under file://) must
    // also be absent in the export viewer — it is a server-only action.
    await expect(offlinePage.getByRole("button", { name: "Export canvas" })).toHaveCount(0);
    await offlineContext.close();
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  test("downloads a PNG of the complete diagram without editor controls", async ({ page }) => {
    await page.goto(SHARED_BASE_URL);
    await waitForBoot(page);

    // Make the visible viewport intentionally unrepresentative. The exported image must still
    // use graph bounds rather than browser viewport bounds.
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.getByRole("button", { name: "Zoom in" }).click();

    await page.getByRole("button", { name: "Export canvas" }).click();
    const dialog = page.getByRole("dialog", { name: /Export/ });
    await expect(dialog.getByRole("radio", { name: "Image" })).toBeChecked();
    await expect(dialog.getByRole("radio", { name: /HTML \(interactive\)/i })).toBeVisible();

    const downloadPromise = page.waitForEvent("download", { timeout: 15_000 });
    await dialog.getByRole("button", { name: "Download image" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/-hqflow\.png$/);

    const tmpDir = await fsp.mkdtemp(path.join(await import("node:os").then((m) => m.tmpdir()), "hqflow-image-"));
    const imagePath = path.join(tmpDir, "diagram.png");
    await download.saveAs(imagePath);
    const bytes = await fsp.readFile(imagePath);
    const { width, height } = pngDimensions(bytes);

    expect(bytes.byteLength).toBeGreaterThan(50_000);
    expect(width).toBeGreaterThanOrEqual(800);
    expect(height).toBeGreaterThanOrEqual(800);
    expect(width).toBeGreaterThan(page.viewportSize()?.width ?? 0);

    await fsp.rm(tmpDir, { recursive: true, force: true });
  });
});
