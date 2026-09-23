/**
 * Small, page-level helpers reused across specs. These stable selectors are exercised by the
 * committed Playwright interaction and screenshot coverage.
 */
import type { Locator, Page } from "@playwright/test";

/** Waits for the board to have rendered at least one step node. */
export async function waitForBoot(page: Page): Promise<void> {
  await page.locator("[data-step-node]").first().waitFor({ state: "visible", timeout: 15_000 });
}

export function workflowNavItem(page: Page, workflowName: string): Locator {
  return page.locator("button[data-workflow-item]").filter({ hasText: workflowName });
}

/** Opens the workflow tree from the dock (it rises above it) and picks a workflow; picking closes it. */
export async function selectWorkflowByName(page: Page, workflowName: string): Promise<void> {
  const item = workflowNavItem(page, workflowName);
  if (!(await item.isVisible())) {
    await page.getByRole("button", { name: /^Workflows: / }).click();
  }
  await item.click();
}

export function stepNode(page: Page, stepId: string): Locator {
  return page.locator(`[data-step-node="${stepId}"]`);
}
