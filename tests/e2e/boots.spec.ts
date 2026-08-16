/**
 * Runs against the shared, read-only server (see playwright.config.ts's `webServer`), which
 * serves a private temp copy of the test project — never the committed fixture itself.
 */
import { expect, test } from "@playwright/test";

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
  await page.locator("[data-step-node]").first().waitFor({ state: "visible", timeout: 15_000 });

  // Repository name (from .codehq/project.json's project.name) appears in the top bar.
  await expect(page.getByText("MotionA", { exact: true })).toBeVisible();

  // The default workflow (settings.defaultWorkflowId === "generate-video") is auto-selected.
  const defaultWorkflowItem = page.locator('button[data-workflow-item][aria-current="true"]');
  await expect(defaultWorkflowItem).toContainText("Generate Video Prompt");

  // Its 11 step nodes render — 7 work steps plus 4 terminal outcome pills (400/429/502/201),
  // split out of the single "Save Result" catch-all so each real failure mode (invalid request,
  // over quota, unreachable site) reads as its own named result (contract mandate: honest
  // outcome nodes, not a shared error sink).
  await expect(page.locator("[data-step-node]")).toHaveCount(11);

  // Its 10 connectors render, each with non-zero rendered geometry.
  const edges = page.locator(".react-flow__edge");
  await expect(edges).toHaveCount(10);

  const edgePathLengths = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".react-flow__edge path.react-flow__edge-path")).map((el) =>
      (el as SVGPathElement).getTotalLength(),
    ),
  );
  expect(edgePathLengths).toHaveLength(10);
  for (const length of edgePathLengths) {
    expect(length).toBeGreaterThan(0);
  }

  expect(consoleErrors, `Unexpected browser console errors during load:\n${consoleErrors.join("\n")}`).toEqual([]);
  expect(pageErrors, `Unexpected uncaught page errors during load:\n${pageErrors.join("\n")}`).toEqual([]);
});
