/**
 * Uses a disposable copy of MotionA only as the host repository, then injects the explicitly
 * synthetic e2e fixture. The demo is never committed under examples/motiona and makes no claim
 * about that example's source behavior.
 */
import { promises as fsp } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { selectWorkflowByName, waitForBoot } from "./helpers/app";
import { createTempFixtureCopy, removeTempDir } from "./helpers/fixture";
import { PORTS, REPO_ROOT } from "./helpers/paths";
import { startCodeHQServer, type ManagedServer } from "./helpers/server";

const ARTIFACT_DIR = path.join(REPO_ROOT, ".amp", "in", "artifacts");
const DEMO_SOURCE = path.join(REPO_ROOT, "tests", "e2e", "fixtures", "canvas-grammar-demo.json");
const BACKGROUND_PRESETS = [
  { id: "grid", label: "Graph paper" },
  { id: "mist", label: "Mist forest" },
  { id: "blueprint", label: "Blueprint" },
  { id: "plain", label: "Plain" },
] as const;
let root: string;
let server: ManagedServer;

async function setTheme(page: Page, theme: "dark" | "light"): Promise<void> {
  const current = await page.locator("html").getAttribute("data-theme");
  if (current !== theme) {
    await page.getByRole("button", { name: `Switch to ${theme} theme` }).click();
  }
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

async function setCanvasBackground(page: Page, background: (typeof BACKGROUND_PRESETS)[number]): Promise<void> {
  const trigger = page.locator('button[aria-label^="Canvas background:"]');
  await trigger.click();
  const menu = page.getByRole("menu", { name: "Canvas background options" });
  await menu.getByRole("menuitemradio", { name: new RegExp(`^${background.label}`) }).click();
  await expect(page.locator("[data-canvas-background]")).toHaveAttribute("data-canvas-background", background.id);
  await expect(trigger).toHaveAttribute("aria-label", `Canvas background: ${background.label}`);
}

interface AdaptiveCanvasReport {
  cardCount: number;
  cardsReadable: boolean;
  cardSurfaceAlpha: number[];
  cardBoundariesVisible: boolean;
  cardBlur: string[];
  edgeCount: number;
  edgesProtected: boolean;
  labelCount: number;
  labelsProtected: boolean;
  oneRovingTabStop: boolean;
}

/** Returns the browser's final style/a11y state for the adaptive-surface contract. */
async function inspectAdaptiveCanvas(page: Page): Promise<AdaptiveCanvasReport> {
  return page.evaluate(() => {
    const alphaOf = (color: string): number => {
      const slash = color.lastIndexOf("/");
      if (slash !== -1) {
        const alpha = Number.parseFloat(color.slice(slash + 1).replace(")", "").trim());
        return Number.isNaN(alpha) ? 1 : alpha;
      }
      const rgba = color.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/);
      return rgba === null ? 1 : Number.parseFloat(rgba[1]!);
    };
    const isVisible = (element: HTMLElement): boolean => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const cards = Array.from(document.querySelectorAll<HTMLElement>("[data-step-node]"));
    const cardStyles = cards.map((card) => {
      const style = getComputedStyle(card);
      const textElements = [card, ...Array.from(card.querySelectorAll<HTMLElement>("*"))]
        .filter((element) => (element.textContent ?? "").trim().length > 0);
      return {
        accessible: card.getAttribute("role") === "button"
          && (card.getAttribute("aria-label") ?? "").trim().length > 0,
        visibleText: (card.textContent ?? "").trim().length > 0,
        textColors: textElements.every((element) => {
          const color = getComputedStyle(element).color;
          return color !== "transparent" && !color.endsWith("/ 0)");
        }),
        alpha: alphaOf(style.backgroundColor),
        boundary: Number.parseFloat(style.borderTopWidth) > 0
          && style.borderTopColor !== "transparent"
          && style.boxShadow !== "none",
        blur: style.backdropFilter,
      };
    });
    const edgeGroups = Array.from(document.querySelectorAll<SVGGElement>("[data-workflow-edge]"));
    const edgesProtected = edgeGroups.every((group) => {
      const paths = Array.from(group.querySelectorAll<SVGPathElement>("path"));
      const semantic = paths.find((path) => path.classList.contains("react-flow__edge-path"));
      const halo = paths.find(
        (path) => !path.classList.contains("react-flow__edge-path")
          && !path.classList.contains("react-flow__edge-interaction"),
      );
      if (semantic === undefined || halo === undefined || semantic.getAttribute("d") === null) {
        return false;
      }
      const semanticStyle = getComputedStyle(semantic);
      const haloStyle = getComputedStyle(halo);
      return semantic.getAttribute("d")!.length > 0
        && haloStyle.stroke !== "none"
        && Number.parseFloat(haloStyle.strokeWidth) > Number.parseFloat(semanticStyle.strokeWidth)
        && semantic.getAttribute("marker-end") !== null;
    });
    const labels = Array.from(document.querySelectorAll<HTMLElement>("[data-edge-label]"));
    const labelsProtected = labels.length > 0 && labels.every((label) => {
      const style = getComputedStyle(label);
      return isVisible(label)
        && (label.textContent ?? "").trim().length > 0
        && label.getAttribute("aria-hidden") === null
        && style.pointerEvents === "none"
        && Number.parseFloat(style.borderTopWidth) > 0
        && style.borderTopColor !== "transparent"
        && style.backgroundColor !== "rgba(0, 0, 0, 0)"
        && alphaOf(style.backgroundColor) > 0.9;
    });
    return {
      cardCount: cards.length,
      cardsReadable: cardStyles.every((card) => card.accessible && card.visibleText && card.textColors),
      cardSurfaceAlpha: cardStyles.map((card) => card.alpha),
      cardBoundariesVisible: cardStyles.every((card) => card.boundary),
      cardBlur: cardStyles.map((card) => card.blur),
      edgeCount: edgeGroups.length,
      edgesProtected,
      labelCount: labels.length,
      labelsProtected,
      oneRovingTabStop: cards.filter((card) => card.getAttribute("tabindex") === "0").length === 1,
    };
  });
}

async function capture(page: Page, workflow: string, slug: string, theme: "dark" | "light"): Promise<void> {
  await selectWorkflowByName(page, workflow);
  await waitForBoot(page);
  await setTheme(page, theme);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, `${slug}-${theme}-1440x900.png`), animations: "disabled" });
}

async function edgeEndpointDistance(
  page: Page,
  edgeId: string,
  nodeId: string,
  handleId: string,
  endpoint: "source" | "target",
): Promise<number> {
  return page.evaluate(({ edgeId, nodeId, handleId, endpoint }) => {
    const path = document.querySelector<SVGPathElement>(
      `.react-flow__edge[data-id="${edgeId}"] path.react-flow__edge-path`,
    );
    const handle = document.querySelector<HTMLElement>(
      `[data-nodeid="${nodeId}"][data-handleid="${handleId}"]`,
    );
    if (path === null || handle === null) {
      return Number.POSITIVE_INFINITY;
    }
    const point = path.getPointAtLength(endpoint === "source" ? 0 : path.getTotalLength());
    const screenPoint = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM() ?? new DOMMatrix());
    const rect = handle.getBoundingClientRect();
    return Math.hypot(screenPoint.x - (rect.left + rect.width / 2), screenPoint.y - (rect.top + rect.height / 2));
  }, { edgeId, nodeId, handleId, endpoint });
}

test.beforeAll(async () => {
  root = await createTempFixtureCopy("canvas-grammar");
  await fsp.copyFile(DEMO_SOURCE, path.join(root, ".codehq", "workflows", "canvas-grammar-demo.json"));
  await fsp.mkdir(ARTIFACT_DIR, { recursive: true });
  server = await startCodeHQServer(root, PORTS.canvasGrammar);
});

test.afterAll(async () => {
  await server.stop();
  await removeTempDir(root);
});

test("renders the synthetic retry, return, async, fan-out/fan-in, and outcomes without overlaps", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(server.url);
  await waitForBoot(page);
  await selectWorkflowByName(page, "Canvas Grammar Demo");
  await expect(page.locator('[data-step-node="accept-job"]')).toBeVisible();

  for (const label of ["retry ≤3", "re-encode", "handoff", "invalid", "queued"]) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }

  const retry = page.locator('.react-flow__edge[data-id="retry-encode"] path.react-flow__edge-path');
  const returned = page.locator('.react-flow__edge[data-id="review-reencode"] path.react-flow__edge-path');
  const asyncHandoff = page.locator('.react-flow__edge[data-id="review-notify"] path.react-flow__edge-path');
  await expect(retry).toHaveCSS("stroke-dasharray", /8px, 6px/);
  await expect(returned).toHaveCSS("stroke-dasharray", /8px, 6px/);
  await expect(asyncHandoff).toHaveCSS("stroke-dasharray", /1px, 6px/);
  expect(await retry.getAttribute("d")).not.toBe(await returned.getAttribute("d"));

  await expect(page.locator('[data-step-node="outcome-created"]')).toHaveAttribute("aria-label", /^Success outcome:/);
  await expect(page.locator('[data-step-node="outcome-rejected"]')).toHaveAttribute("aria-label", /^Failure outcome:/);
  await expect(page.locator('[data-step-node="outcome-queued"]')).toHaveAttribute("aria-label", /^Outcome:/);

  const overlaps = await page.locator("[data-step-node]").evaluateAll((nodes) => {
    const entries = nodes.map((node) => ({ id: (node as HTMLElement).dataset.stepNode ?? "?", rect: node.getBoundingClientRect() }));
    return entries.flatMap((left, index) => entries.slice(index + 1).flatMap((right) => {
      const intersects = left.rect.left < right.rect.right && left.rect.right > right.rect.left &&
        left.rect.top < right.rect.bottom && left.rect.bottom > right.rect.top;
      return intersects ? [`${left.id}/${right.id}`] : [];
    }));
  });
  expect(overlaps).toEqual([]);
});

test("keeps a connection attached while its card is freely dragged", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(server.url);
  await waitForBoot(page);
  await selectWorkflowByName(page, "Generate Video Prompt");

  const node = page.locator('[data-step-node="validate-request"]');
  const edge = page.locator('.react-flow__edge[data-id^="receive-request->validate-request"] path.react-flow__edge-path');
  const before = await edge.getAttribute("d");
  const box = await node.boundingBox();
  expect(box).not.toBeNull();

  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 120, box!.y + box!.height / 2 + 70, { steps: 12 });
  await page.mouse.up();

  await expect.poll(() => edge.getAttribute("d")).not.toBe(before);
  const endpointDistance = await edge.evaluate((path) => {
    const svgPath = path as SVGPathElement;
    const endpoint = svgPath.getPointAtLength(svgPath.getTotalLength());
    const screenEndpoint = new DOMPoint(endpoint.x, endpoint.y).matrixTransform(svgPath.getScreenCTM() ?? new DOMMatrix());
    const handle = document.querySelector<HTMLElement>('[data-nodeid="validate-request"][data-handleid="in"]');
    if (handle === null) return Number.POSITIVE_INFINITY;
    const rect = handle.getBoundingClientRect();
    return Math.hypot(screenEndpoint.x - (rect.left + rect.width / 2), screenEndpoint.y - (rect.top + rect.height / 2));
  });
  expect(endpointDistance).toBeLessThan(5);
});

test("switches ordinary connections to the closest facing card sides while dragging", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(server.url);
  await waitForBoot(page);
  await selectWorkflowByName(page, "Generate Video Prompt");

  const edgeId = "receive-request->validate-request#0";
  const sourceId = "receive-request";
  const targetId = "validate-request";
  const source = page.locator(`[data-step-node="${sourceId}"]`);
  const target = page.locator(`[data-step-node="${targetId}"]`);
  const sourceBox = await source.boundingBox();
  const initialTargetBox = await target.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(initialTargetBox).not.toBeNull();

  // Move B from the right of A to the left. Assert before mouse-up to prove the handles switch
  // continuously during the drag rather than only after React Flow commits a final position.
  await page.mouse.move(
    initialTargetBox!.x + initialTargetBox!.width / 2,
    initialTargetBox!.y + initialTargetBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    sourceBox!.x - initialTargetBox!.width / 2 - 80,
    sourceBox!.y + sourceBox!.height / 2,
    { steps: 16 },
  );
  await expect.poll(() => edgeEndpointDistance(page, edgeId, sourceId, "out-left", "source")).toBeLessThan(5);
  await expect.poll(() => edgeEndpointDistance(page, edgeId, targetId, "in-right", "target")).toBeLessThan(5);
  await page.mouse.up();

  // Moving B below A should choose the source bottom and target top instead of either horizontal
  // side, using the same dominant-axis rule as the production canvas. Start from a fresh board so
  // the first scenario's deliberately off-mainline card cannot be clipped by the viewport.
  await page.goto(server.url);
  await waitForBoot(page);
  await selectWorkflowByName(page, "Generate Video Prompt");
  const verticalSourceBox = await source.boundingBox();
  const verticalTargetBox = await target.boundingBox();
  expect(verticalSourceBox).not.toBeNull();
  expect(verticalTargetBox).not.toBeNull();
  await page.mouse.move(
    verticalTargetBox!.x + verticalTargetBox!.width / 2,
    verticalTargetBox!.y + verticalTargetBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    verticalSourceBox!.x + verticalSourceBox!.width / 2,
    verticalSourceBox!.y + verticalSourceBox!.height + verticalTargetBox!.height / 2 + 80,
    { steps: 16 },
  );
  await expect.poll(() => edgeEndpointDistance(page, edgeId, sourceId, "out-bottom", "source")).toBeLessThan(5);
  await expect.poll(() => edgeEndpointDistance(page, edgeId, targetId, "in-top", "target")).toBeLessThan(5);
  await page.mouse.up();
});

test("switches outcome connections to facing sides while dragging success and failure outcomes", async ({ page }) => {
  // This demo's semantic outcome bands extend beyond the default 1280px test viewport. Keep the
  // source and target within the real pointer event region so this exercises a drag, not an
  // off-screen mouse coordinate.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(server.url);
  await waitForBoot(page);
  await selectWorkflowByName(page, "Canvas Grammar Demo");

  const sourceId = "review";
  const source = page.locator("[data-step-node=\"" + sourceId + "\"]");
  const successOutcome = page.locator("[data-step-node=\"outcome-created\"]");
  const sourceBox = await source.boundingBox();
  const successBox = await successOutcome.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(successBox).not.toBeNull();

  // Move the success outcome left of its source. The edge must switch from the semantic
  // bottom/top route to the facing left/right cardinal pair while the drag is still active.
  await page.mouse.move(successBox!.x + successBox!.width / 2, successBox!.y + successBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    sourceBox!.x - successBox!.width / 2 - 440,
    sourceBox!.y + sourceBox!.height / 2,
    { steps: 16 },
  );
  await expect.poll(() => edgeEndpointDistance(page, "review-created", sourceId, "out-left", "source")).toBeLessThan(5);
  await expect.poll(() => edgeEndpointDistance(page, "review-created", "outcome-created", "in-right", "target")).toBeLessThan(5);
  await page.mouse.up();

  // A fresh board gives the failure outcome its original above-the-line position. Dragging it
  // below the source exercises the opposite semantic band with the vertical cardinal pair.
  await page.goto(server.url);
  await waitForBoot(page);
  await selectWorkflowByName(page, "Canvas Grammar Demo");
  const failureOutcome = page.locator("[data-step-node=\"outcome-rejected\"]");
  const verticalSourceBox = await source.boundingBox();
  const failureBox = await failureOutcome.boundingBox();
  expect(verticalSourceBox).not.toBeNull();
  expect(failureBox).not.toBeNull();

  await page.mouse.move(failureBox!.x + failureBox!.width / 2, failureBox!.y + failureBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    verticalSourceBox!.x + verticalSourceBox!.width / 2,
    verticalSourceBox!.y + verticalSourceBox!.height + failureBox!.height / 2 + 80,
    { steps: 16 },
  );
  await expect.poll(() => edgeEndpointDistance(page, "review-rejected", sourceId, "out-bottom", "source")).toBeLessThan(5);
  await expect.poll(() => edgeEndpointDistance(page, "review-rejected", "outcome-rejected", "in-top", "target")).toBeLessThan(5);
  await page.mouse.up();
});

test("keeps repeated drag updates error-free and deterministic", async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") {
      runtimeErrors.push(`console.error: ${message.text()}`);
    }
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(server.url);
  await waitForBoot(page);
  await selectWorkflowByName(page, "Canvas Grammar Demo");

  const source = page.locator('[data-step-node="review"]');
  const target = page.locator('[data-step-node="outcome-created"]');
  const sourceBox = await source.boundingBox();
  expect(sourceBox).not.toBeNull();

  const moveTarget = async (): Promise<string> => {
    const targetBox = await target.boundingBox();
    expect(targetBox).not.toBeNull();
    await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      sourceBox!.x - targetBox!.width / 2 - 40,
      sourceBox!.y + sourceBox!.height / 2,
      { steps: 12 },
    );
    await page.mouse.up();
    return (await page.locator('.react-flow__edge[data-id="review-created"] path.react-flow__edge-path').getAttribute("d")) ?? "";
  };

  const firstPath = await moveTarget();
  expect(runtimeErrors).toEqual([]);

  // Return to the same deterministic initial state, then replay the same pointer path. The route
  // string must match exactly; this catches order-dependent candidate selection without a timing
  // or performance assertion.
  await page.goto(server.url);
  await waitForBoot(page);
  await selectWorkflowByName(page, "Canvas Grammar Demo");
  const replayPath = await moveTarget();
  expect(replayPath).toBe(firstPath);
  expect(runtimeErrors).toEqual([]);
});

test("protects cards, connections, and labels across selected backgrounds and themes", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(server.url);
  await waitForBoot(page);
  await selectWorkflowByName(page, "Canvas Grammar Demo");
  const reports: Array<AdaptiveCanvasReport & { theme: "dark" | "light"; background: string }> = [];

  for (const theme of ["dark", "light"] as const) {
    await setTheme(page, theme);
    for (const background of BACKGROUND_PRESETS) {
      await setCanvasBackground(page, background);
      const report = await inspectAdaptiveCanvas(page);
      reports.push({ theme, background: background.id, ...report });

      expect(report.cardCount, `${theme}/${background.id} card count`).toBe(9);
      expect(report.cardsReadable, `${theme}/${background.id} card text and names`).toBe(true);
      expect(report.cardSurfaceAlpha.every((alpha) => alpha >= 0.08 && alpha <= 0.16), `${theme}/${background.id} low card tint`).toBe(true);
      expect(report.cardBoundariesVisible, `${theme}/${background.id} card boundaries`).toBe(true);
      expect(report.cardBlur.every((filter) => filter.includes("blur(12px)") && filter.includes("saturate(1.35)")), `${theme}/${background.id} local blur and saturation`).toBe(true);
      expect(report.edgeCount, `${theme}/${background.id} edge count`).toBe(11);
      expect(report.edgesProtected, `${theme}/${background.id} edge casing and markers`).toBe(true);
      expect(report.labelCount, `${theme}/${background.id} edge label count`).toBe(5);
      expect(report.labelsProtected, `${theme}/${background.id} edge label protection`).toBe(true);
      expect(report.oneRovingTabStop, `${theme}/${background.id} keyboard roving tab stop`).toBe(true);

      await page.screenshot({
        path: path.join(ARTIFACT_DIR, "canvas-background", `grammar-${background.id}-${theme}.png`),
        animations: "disabled",
      });
    }
  }

  await fsp.writeFile(
    path.join(ARTIFACT_DIR, "canvas-background", "adaptive-canvas-dom-report.json"),
    `${JSON.stringify({ viewport: "1920x1080", reducedMotion: true, states: reports }, null, 2)}\n`,
    "utf8",
  );
});

test("uses uploaded image pixels through cards and changes text contrast when a card moves", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(server.url);
  await waitForBoot(page);
  await selectWorkflowByName(page, "Canvas Grammar Demo");

  const image = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900">
      <rect width="800" height="900" fill="#07110b"/>
      <rect x="800" width="800" height="900" fill="#fff8dc"/>
      <circle cx="360" cy="280" r="220" fill="#176b35"/>
      <circle cx="1240" cy="280" r="220" fill="#ffc34d"/>
    </svg>
  `);
  await page.locator('button[aria-label^="Canvas background:"]').click();
  await page.getByLabel("Upload canvas background image").setInputFiles({
    name: "contrast-zones.svg",
    mimeType: "image/svg+xml",
    buffer: image,
  });

  const stage = page.locator("[data-canvas-background]");
  const card = page.locator("[data-step-node]").first();
  await expect(stage).toHaveAttribute("data-canvas-background", "custom");
  await expect(page.locator('button[aria-label^="Canvas background:"]')).toHaveAttribute(
    "aria-label",
    "Canvas background: Custom image",
  );
  await expect(card).toHaveCSS("background-color", /(?:\/ 0\.1|, 0\.1)\)/);
  await expect(card).toHaveCSS("backdrop-filter", /blur\(12px\).*saturate\(1\.35\)/);

  const stageBox = await stage.boundingBox();
  const cardBox = await card.boundingBox();
  expect(stageBox).not.toBeNull();
  expect(cardBox).not.toBeNull();
  const dragCardTo = async (x: number): Promise<void> => {
    const current = await card.boundingBox();
    expect(current).not.toBeNull();
    await page.mouse.move(current!.x + current!.width / 2, current!.y + current!.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, stageBox!.y + stageBox!.height / 2, { steps: 12 });
    await page.mouse.up();
  };

  await dragCardTo(stageBox!.x + cardBox!.width / 2 + 24);
  await expect(card).toHaveAttribute("data-card-text", "light");
  const lightTextColor = await card.locator("p").first().evaluate((element) => getComputedStyle(element).color);

  await dragCardTo(stageBox!.x + stageBox!.width - cardBox!.width / 2 - 24);
  await expect(card).toHaveAttribute("data-card-text", "dark");
  const darkTextColor = await card.locator("p").first().evaluate((element) => getComputedStyle(element).color);
  expect(darkTextColor).not.toBe(lightTextColor);

  await page.screenshot({
    path: path.join(ARTIFACT_DIR, "canvas-background", "uploaded-background-adaptive-card.png"),
    animations: "disabled",
  });
});

test("keeps the canvas readable in forced-colors mode", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await page.goto(server.url);
  await waitForBoot(page);
  await selectWorkflowByName(page, "Canvas Grammar Demo");
  await setCanvasBackground(page, BACKGROUND_PRESETS[1]!);

  const forcedColorsState = await page.evaluate(() => {
    const stage = document.querySelector<HTMLElement>("[data-canvas-background]");
    const card = document.querySelector<HTMLElement>("[data-step-node]");
    const label = document.querySelector<HTMLElement>("[data-edge-label]");
    if (stage === null || card === null || label === null) {
      return null;
    }
    const cardStyle = getComputedStyle(card);
    const labelStyle = getComputedStyle(label);
    return {
      stageBackgroundImage: getComputedStyle(stage).backgroundImage,
      cardBackgroundImage: cardStyle.backgroundImage,
      cardBackdropFilter: cardStyle.backdropFilter,
      cardBorderWidth: cardStyle.borderTopWidth,
      labelBackgroundColor: labelStyle.backgroundColor,
      labelBorderWidth: labelStyle.borderTopWidth,
    };
  });

  expect(forcedColorsState).not.toBeNull();
  expect(forcedColorsState?.stageBackgroundImage).toBe("none");
  expect(forcedColorsState?.cardBackgroundImage).toBe("none");
  expect(forcedColorsState?.cardBackdropFilter).toBe("none");
  expect(Number.parseFloat(forcedColorsState?.cardBorderWidth ?? "0")).toBeGreaterThan(0);
  expect(forcedColorsState?.labelBackgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(Number.parseFloat(forcedColorsState?.labelBorderWidth ?? "0")).toBeGreaterThan(0);
  expect(await page.locator("[data-step-node][role=\"button\"]").count()).toBe(9);
});

test("captures deterministic dark and light review screenshots", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(server.url);
  await waitForBoot(page);

  for (const theme of ["dark", "light"] as const) {
    await capture(page, "Generate Video Prompt", "generate-video", theme);
    await capture(page, "Upload Reference Asset", "upload-assets", theme);
    await capture(page, "Canvas Grammar Demo", "canvas-grammar-demo", theme);
  }
});
