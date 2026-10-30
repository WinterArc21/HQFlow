/**
 * Runs against the shared, read-only server (see playwright.config.ts's `webServer`), which
 * serves a private temp copy of the test project — never the committed fixture itself.
 */
import { expect, test } from "@playwright/test";
import { waitForBoot } from "./helpers/app";

test("loads the test project, auto-selects the default workflow, and renders its board with no console errors", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  await page.goto("/");
  await waitForBoot(page);

  // Repository name (from .codehq/project.json's project.name) appears in the identity island.
  await expect(page.getByRole("banner").getByText("MotionA", { exact: true })).toBeVisible();

  // The default workflow (settings.defaultWorkflowId === "generate-video") is auto-selected: the
  // title card names it, and the workflow tree that opens under the title marks it current.
  const workflowsButton = page.getByRole("button", { name: "Workflows: Generate Video Prompt" });
  await expect(workflowsButton).toBeVisible();
  await workflowsButton.click();
  const defaultWorkflowItem = page.locator('button[data-workflow-item][aria-current="true"]');
  await expect(defaultWorkflowItem).toContainText("Generate Video Prompt");
  await page.keyboard.press("Escape");
  await expect(defaultWorkflowItem).toBeHidden();

  // Its 11 step nodes render — 7 work steps plus 4 terminal outcome pills (400/429/502/201),
  // split out of the single "Save Result" catch-all so each real failure mode (invalid request,
  // over quota, unreachable site) reads as its own named result (contract mandate: honest
  // outcome nodes, not a shared error sink).
  // Connector geometry is checked in edges-without-measurement.spec.ts.
  await expect(page.locator("[data-step-node]")).toHaveCount(11);

  expect(consoleErrors, `Unexpected browser console errors during load:\n${consoleErrors.join("\n")}`).toEqual([]);
  expect(pageErrors, `Unexpected uncaught page errors during load:\n${pageErrors.join("\n")}`).toEqual([]);
});

test("off-screen cards do not show edge tags in tall or wide views", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await waitForBoot(page);

  for (const view of ["Flow", "Line"]) {
    await page.getByRole("button", { name: `${view} view`, exact: true }).click();
    for (let i = 0; i < 4; i += 1) {
      await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    }
    // Check the graph really extends past this edge, so absence is not just a fully fitted map.
    await expect.poll(() => page.locator(".react-flow").evaluate((canvas, direction) => {
      const stage = canvas.getBoundingClientRect();
      return [...canvas.querySelectorAll(".react-flow__node")].some((node) => {
        const rect = node.getBoundingClientRect();
        return direction === "Flow" ? rect.bottom > stage.bottom : rect.right > stage.right;
      });
    }, view)).toBe(true);
    await expect(page.getByRole("button", { name: /Show more (below|to the right)/ })).toHaveCount(0);
  }
});
