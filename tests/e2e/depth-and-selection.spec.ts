/**
 * Runs against the shared, read-only server (see playwright.config.ts's `webServer`).
 */
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.locator("[data-step-node]").first().waitFor({ state: "visible", timeout: 15_000 });
});

test("keeps the board on the story and has no Code map control", async ({ page }) => {
  await expect(page.getByRole("group", { name: "Canvas altitude" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Code map" })).toHaveCount(0);
  await expect(page.getByText("Files", { exact: true })).toHaveCount(0);
});

test("clicking a node opens the step drawer showing that step's name and purpose", async ({ page }) => {
  await page.locator('[data-step-node="scrape-website"]').click();

  // StepDrawer sets both aria-label ("... details") and aria-labelledby (pointing at the h2);
  // per the accessible-name algorithm aria-labelledby wins, so the dialog's real accessible
  // name is just the step name.
  const drawer = page.getByRole("dialog", { name: "Scrape Website" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "Scrape Website" })).toBeVisible();
  await expect(drawer).toContainText("Fetches the submitted page and extracts its title, description, body text, and images.");
});

test("keyboard navigation follows the narrative vertically", async ({ page }) => {
  const first = page.locator('[data-step-node="receive-request"]');
  await first.focus();
  await expect(first).toBeFocused();

  await first.press("ArrowDown");
  const second = page.locator('[data-step-node="validate-request"]');
  await expect(second).toBeFocused();

  await second.press("ArrowDown");
  const third = page.locator('[data-step-node="check-quota"]');
  await expect(third).toBeFocused();

  await third.press("ArrowUp");
  await expect(second).toBeFocused();
});

test("keyboard navigation reaches the invalid-request outcome and returns to its decision", async ({ page }) => {
  const entry = page.locator('[data-step-node="receive-request"]');
  await entry.focus();

  // Down follows the primary path to validation; Right enters its side outcome.
  await entry.press("ArrowDown");
  const validation = page.locator('[data-step-node="validate-request"]');
  await expect(validation).toBeFocused();
  await validation.press("ArrowRight");

  const invalid = page.locator('[data-step-node="outcome-invalid-request"]');
  await expect(invalid).toBeFocused();
  await invalid.press("ArrowLeft");
  await expect(validation).toBeFocused();
});

test("hover traces related nodes without decorative zone labels", async ({ page }) => {
  // The horizontal canvas needs enough room for the third main-line card to be fully under the
  // pointer. At the default 1280px test viewport it is clipped at the right edge, which causes
  // Playwright to leave the card immediately after entering it.
  await page.setViewportSize({ width: 1440, height: 900 });

  const anchor = page.locator('[data-step-node="check-quota"]');
  const upstream = page.locator('[data-step-node="validate-request"]');
  const downstream = page.locator('[data-step-node="scrape-website"]');
  const downstreamOutcome = page.locator('[data-step-node="outcome-quota-exceeded"]');
  const unrelated = page.locator('[data-step-node="outcome-invalid-request"]');
  const outgoingEdges = page.locator('.react-flow__edge[data-id^="check-quota->"]');

  await anchor.hover();
  await expect(anchor).toHaveCSS("opacity", "1");
  await expect(upstream).toHaveCSS("opacity", "1");
  await expect(downstream).toHaveCSS("opacity", "1");
  await expect(downstreamOutcome).toHaveCSS("opacity", "1");
  await expect(outgoingEdges).toHaveCount(2);
  for (const edge of await outgoingEdges.all()) {
    await expect(edge).toHaveCSS("opacity", "1");
  }
  await expect.poll(() => unrelated.evaluate((node) => getComputedStyle(node).opacity)).toBe("0.35");

  await page.mouse.move(0, 0);
  await expect(page.locator(".react-flow__node-zoneLabel")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  for (const node of await page.locator("[data-step-node]").all()) {
    await expect(node).toHaveCSS("opacity", "1");
  }
});

test("Escape closes the drawer and restores focus to the originating node", async ({ page }) => {
  const node = page.locator('[data-step-node="check-quota"]');
  await node.click();

  const drawer = page.getByRole("dialog", { name: "Check Quota" });
  await expect(drawer).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(node).toBeFocused();
});
