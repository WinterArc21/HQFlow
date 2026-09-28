/**
 * Editing code a workflow points at flags exactly the steps that reference it, live, and both
 * ways out clear the flags: the agent rewriting the workflow, or "Mark as up to date". No
 * `page.reload()` anywhere — every change arrives over SSE from the real source watcher.
 *
 * Isolation: owns port 4509 (helpers/paths.ts PORTS.outdatedSources) and a private temp copy of
 * the test project.
 */
import { promises as fsp } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { createTempFixtureCopy, removeTempDir } from "./helpers/fixture";
import { PORTS } from "./helpers/paths";
import { startCodeHQServer, type ManagedServer } from "./helpers/server";

let root: string;
let server: ManagedServer;

test.describe.configure({ mode: "serial" });

test.beforeEach(async () => {
  root = await createTempFixtureCopy("outdated-sources");
  server = await startCodeHQServer(root, PORTS.outdatedSources);
});

test.afterEach(async () => {
  await server.stop();
  await removeTempDir(root);
});

test("a code edit flags the steps that reference it, and re-mapping or marking up to date clears them", async ({ page }) => {
  await page.goto(server.url);
  await page.locator("[data-step-node]").first().waitFor({ state: "visible", timeout: 15_000 });
  await expect(page.locator("[data-code-changed]")).toHaveCount(0);
  await expect(page.locator("[data-outdated-notice]")).toHaveCount(0);

  // lib/validation.ts backs Validate Request, Check Quota, and their two failure outcomes.
  await fsp.appendFile(path.join(root, "lib", "validation.ts"), "// allow up to 5 reference images\n");

  const flagged = page.locator("[data-step-node]:has([data-code-changed])");
  await expect(flagged).toHaveCount(4, { timeout: 10_000 });
  expect(await flagged.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-step-node")).sort())).toEqual([
    "check-quota",
    "outcome-invalid-request",
    "outcome-quota-exceeded",
    "validate-request",
  ]);
  const notice = page.locator("[data-outdated-notice]");
  await expect(notice).toContainText("4 steps may be outdated");
  await expect(notice).toContainText("lib/validation.ts");

  // The agent re-checks the steps and rewrites the workflow file: a fresh baseline, no flags.
  const workflowFile = path.join(root, ".codehq", "workflows", "generate-video.json");
  const workflow = JSON.parse(await fsp.readFile(workflowFile, "utf-8")) as { steps: Array<{ id: string; purpose: string }> };
  const validate = workflow.steps.find((step) => step.id === "validate-request");
  if (validate === undefined) {
    throw new Error("Fixture changed: expected a 'validate-request' step in generate-video.json.");
  }
  validate.purpose = "Checks the URL and up to 5 reference images, and normalizes the tone.";
  await fsp.writeFile(workflowFile, `${JSON.stringify(workflow, null, 2)}\n`, "utf-8");
  await expect(page.locator("[data-code-changed]")).toHaveCount(0, { timeout: 10_000 });
  await expect(notice).toHaveCount(0);

  // A second edit, this time accepted by hand.
  await fsp.appendFile(path.join(root, "lib", "scraper.ts"), "// retry once on timeout\n");
  await expect(notice).toContainText("2 steps may be outdated", { timeout: 10_000 });
  await notice.getByRole("button", { name: "Mark as up to date" }).click();
  await expect(page.locator("[data-code-changed]")).toHaveCount(0, { timeout: 10_000 });
  await expect(notice).toHaveCount(0);
});
