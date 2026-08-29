/** Runs against the shared, read-only server. Clipboard assertions prove the public prompt. */
import path from "node:path";
import { expect, test } from "@playwright/test";
import { selectWorkflowByName, waitForBoot } from "./helpers/app";
import { REPO_ROOT } from "./helpers/paths";

test("edits and copies a workflow-specific agent prompt, then updates it after workflow switching", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await waitForBoot(page);

  await page.getByRole("button", { name: "Refine with agent" }).click();
  let dialog = page.getByRole("dialog", { name: "Refine Generate Video Prompt" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("code").filter({ hasText: "@generate-video" })).toBeVisible();
  await expect(dialog.getByText(".codehq/workflows/generate-video.json", { exact: true })).toBeVisible();

  const customRequest = "@generate-video is too bird's-eye; make it more detailed and keep my punctuation: [exact]!";
  await dialog.getByRole("textbox", { name: "Request" }).fill(customRequest);
  await dialog.getByRole("button", { name: "Copy final prompt" }).click();

  const firstClipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(firstClipboard).toContain("Workflow: @generate-video");
  expect(firstClipboard).toContain("File: .codehq/workflows/generate-video.json");
  expect(firstClipboard).toContain(customRequest);
  expect(firstClipboard).not.toContain("hqflow validate");

  await page.screenshot({
    path: path.join(REPO_ROOT, ".amp", "in", "artifacts", "workflow-agent-prompt-composer.png"),
    animations: "disabled",
  });

  await dialog.getByRole("button", { name: "Close agent prompt composer" }).click();
  await selectWorkflowByName(page, "Upload Reference Asset");
  await page.getByRole("button", { name: "Refine with agent" }).click();
  dialog = page.getByRole("dialog", { name: "Refine Upload Reference Asset" });

  await expect(dialog.getByRole("code").filter({ hasText: "@upload-assets" })).toBeVisible();
  await expect(dialog.getByText(".codehq/workflows/upload-assets.json", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Request" })).toHaveValue("@upload-assets ");
});
