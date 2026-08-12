/**
 * Runs against the shared, read-only server (see playwright.config.ts's `webServer`).
 */
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.locator("[data-step-node]").first().waitFor({ state: "visible", timeout: 15_000 });
});

test("Ctrl+K opens the palette, typing filters results, and Enter opens the matching workflow/step/drawer", async ({
  page,
}) => {
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Search HQFlow" });
  await expect(dialog).toBeVisible();

  const input = dialog.getByRole("combobox");
  await expect(input).toBeFocused();

  // Empty query: the default listing is every workflow (2) plus the available actions (3).
  await expect(dialog.getByRole("option")).toHaveCount(5);
  await expect(dialog.getByRole("option").filter({ hasText: "Generate Video Prompt" })).toBeVisible();
  await expect(dialog.getByRole("option").filter({ hasText: "Upload Reference Asset" })).toBeVisible();
  await expect(dialog.getByRole("option").filter({ hasText: "Reset layout" })).toBeVisible();

  // Search for a step that lives in the NON-default workflow, so activating it proves the
  // palette switches workflows, not just steps within the one already on screen.
  await input.fill("Validate File");

  const results = dialog.getByRole("option");
  await expect(results).toHaveCount(1);
  await expect(results.first()).toContainText("Validate File");
  await expect(results.first()).toContainText("Upload Reference Asset");

  await input.press("Enter");
  await expect(dialog).toBeHidden();

  // The correct workflow is now showing (not the default "Generate Video Prompt")...
  await expect(page.locator('button[data-workflow-item][aria-current="true"]')).toContainText("Upload Reference Asset");

  // ...the step drawer opened for the matched step (StepDrawer's accessible name comes from
  // aria-labelledby, which wins over its redundant aria-label, so it's just the step name)...
  const drawer = page.getByRole("dialog", { name: "Validate File" });
  await expect(drawer).toBeVisible();

  // ...and the canvas re-centred so the selected node is actually in view (search→canvas
  // centering), not just selected off-screen.
  await expect(page.locator('[data-step-node="validate-file"]')).toBeInViewport();
});

test("Escape dismisses the palette, including when opened after the initial page load", async ({ page }) => {
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Search HQFlow" });
  await expect(dialog).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // Regression: the palette is mounted for the whole page lifetime so Ctrl/Cmd+K keeps working,
  // and the focus trap used to only ever attach on the very first mount. Reopening it here,
  // well after initial load, and dismissing it again is the scenario that used to hang.
  await page.keyboard.press("Control+k");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("clicking outside the palette dismisses it, but clicking inside does not", async ({ page }) => {
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Search HQFlow" });
  await expect(dialog).toBeVisible();

  // Click inside the dialog (on its own chrome, not a result row) must not close it.
  await dialog.click({ position: { x: 10, y: 10 } });
  await expect(dialog).toBeVisible();

  // Click on the backdrop, well outside the dialog's bounding box, must close it.
  await page.mouse.click(5, 5);
  await expect(dialog).toBeHidden();
});
