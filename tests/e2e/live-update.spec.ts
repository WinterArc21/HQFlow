/**
 * THE CORE PRODUCT PROMISE: edits to a workflow file on disk are reflected on the board over
 * SSE, with no `page.reload()` anywhere in this file.
 *
 * Isolation: owns port 4501 (helpers/paths.ts PORTS.liveUpdate) and uses a private temp copy of
 * examples/motiona for every test. This file runs serially because its tests intentionally share
 * that one port; other spec files still run in parallel on their own dedicated ports.
 *
 * Live agent presence: a same-workflow addition keeps new node wrappers
 * `data-presence-state="pending"` and hidden until `[data-agent-cursor]` arrives
 * (`data-presence-operation="node:<id>"`, phase `moving` / `revealing`). A new edge then
 * enters `drawing` while the cursor identifies `edge:<key>` and travels source → target.
 * A rename/update alone must not mount a cursor. `prefers-reduced-motion` reveals additions
 * immediately and shows no cursor.
 */
import { promises as fsp } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createTempFixtureCopy, removeTempDir } from "./helpers/fixture";
import { PORTS } from "./helpers/paths";
import { startCodeHQServer, type ManagedServer } from "./helpers/server";

interface MinimalWorkflowFile {
  steps: Array<{ id: string; name: string; [key: string]: unknown }>;
  connections: Array<{ from: string; to: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

let root: string;
let server: ManagedServer;

// Every test owns a fresh fixture, but this spec intentionally shares one dedicated port.
// Override the suite-wide fullyParallel setting so concurrent workers cannot attach to the
// wrong test's server.
test.describe.configure({ mode: "serial" });

test.beforeEach(async () => {
  root = await createTempFixtureCopy("live-update");
  server = await startCodeHQServer(root, PORTS.liveUpdate);
});

test.afterEach(async () => {
  await server.stop();
  await removeTempDir(root);
});

test("renaming a step, then adding a step and connection, both appear live without a page reload", async ({ page }) => {
  await page.goto(server.url);
  await page.locator("[data-step-node]").first().waitFor({ state: "visible", timeout: 15_000 });
  await expect(page.locator("[data-step-node]")).toHaveCount(11);

  const workflowFile = path.join(root, ".codehq", "workflows", "generate-video.json");
  const original = JSON.parse(await fsp.readFile(workflowFile, "utf-8")) as MinimalWorkflowFile;

  // --- Step 1: rename a step ---------------------------------------------------------------
  const renamed = structuredClone(original);
  const receiveRequest = renamed.steps.find((step) => step.id === "receive-request");
  if (receiveRequest === undefined) {
    throw new Error("Fixture changed: expected a 'receive-request' step in generate-video.json.");
  }
  receiveRequest.name = "Receive Incoming Request";
  await fsp.writeFile(workflowFile, `${JSON.stringify(renamed, null, 2)}\n`, "utf-8");

  await expect(page.locator('[data-step-node="receive-request"]')).toContainText("Receive Incoming Request", {
    timeout: 10_000,
  });
  await expect(page.getByText("Receive Request", { exact: true })).toHaveCount(0);

  // --- Step 2: add a new step plus a connection into it -------------------------------------
  const withNewStep = structuredClone(renamed);
  withNewStep.steps.push({
    id: "post-process-video",
    name: "Post-process Video",
    purpose: "Applies final color and audio mastering before delivery.",
    category: "logic",
    confidence: "verified",
  });
  withNewStep.connections.push({ from: "save-result", to: "post-process-video" });
  await fsp.writeFile(workflowFile, `${JSON.stringify(withNewStep, null, 2)}\n`, "utf-8");

  await expect(page.locator("[data-step-node]")).toHaveCount(12, { timeout: 10_000 });
  await expect(page.locator('[data-step-node="post-process-video"]')).toContainText("Post-process Video");
  await expect(page.locator(".react-flow__edge")).toHaveCount(11, { timeout: 10_000 });
});

test("new graph elements complete their live reveal without detaching existing connectors", async ({ page }) => {
  await page.goto(server.url);
  await page.locator("[data-step-node]").first().waitFor({ state: "visible", timeout: 15_000 });

  // Add a new step to trigger the live presence sequence. Existing nodes still move directly to
  // their new layout position so React Flow can keep each connector attached during the reveal.
  const workflowFile = path.join(root, ".codehq", "workflows", "generate-video.json");
  const current = JSON.parse(await fsp.readFile(workflowFile, "utf-8")) as MinimalWorkflowFile;
  const withExtraStep = structuredClone(current);
  withExtraStep.steps.push({
    id: "quality-check",
    name: "Quality Check",
    purpose: "Verifies output quality before delivery.",
    category: "decision",
    confidence: "verified",
  });
  // Turning an existing terminal outcome into a work step forces it to move from the outcome
  // column back to the main line. Connectors must snap with it rather than remaining at the final
  // geometry while the node glides independently.
  withExtraStep.connections.push({ from: "outcome-generation-created", to: "quality-check" });
  await fsp.writeFile(workflowFile, `${JSON.stringify(withExtraStep, null, 2)}\n`, "utf-8");

  await expect(page.locator('[data-step-node="quality-check"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.react-flow__node[data-id="quality-check"]')).not.toHaveAttribute("data-presence-state");
  await expect(page.locator("[data-agent-cursor]")).toHaveCount(0);

  const incomingEdgeId = "save-result->outcome-generation-created#9";
  const connectorDistance = await page.evaluate((edgeId) => {
    const targetHandle = document.querySelector<HTMLElement>('[data-nodeid="outcome-generation-created"][data-handleid="in-top"]');
    const path = document.querySelector<SVGPathElement>(
      `.react-flow__edge[data-id="${edgeId}"] path.react-flow__edge-path`,
    );
    if (targetHandle === null || path === null) {
      return Number.POSITIVE_INFINITY;
    }
    const rect = targetHandle.getBoundingClientRect();
    const endpoint = path.getPointAtLength(path.getTotalLength());
    const screenEndpoint = new DOMPoint(endpoint.x, endpoint.y).matrixTransform(path.getScreenCTM() ?? new DOMMatrix());
    return Math.hypot(screenEndpoint.x - (rect.left + rect.width / 2), screenEndpoint.y - (rect.top + rect.height / 2));
  }, incomingEdgeId);
  // The horizontal canvas attaches incoming connections to the target's live facing handle,
  // rather than the card centre. A larger gap means node and edge geometry diverged during the
  // live update.
  expect(connectorDistance).toBeLessThan(5);
});

const NEW_NODE_ID = "master-output";
const NEW_EDGE_ID = "save-to-master";
const NEW_NODE_OPERATION = `node:${NEW_NODE_ID}`;
const NEW_EDGE_OPERATION = `edge:id:${NEW_EDGE_ID}`;
const MIN_CURSOR_DISPLACEMENT_PX = 8;

interface PresenceCursorSample {
  operation: string | null;
  phase: string | null;
  transform: string;
  x: number;
  y: number;
  time: number;
}

interface PresenceLog {
  pendingHiddenNodeIds: string[];
  nodePhases: string[];
  nodeOperations: string[];
  edgeStates: string[];
  edgeOperations: string[];
  edgePhases: string[];
  cursorSamples: PresenceCursorSample[];
  firstPendingHiddenAt: number | null;
  firstCursorNodeOpAt: number | null;
  firstCardVisibleAt: number | null;
  firstEdgeDrawingAt: number | null;
  firstCursorEdgeOpAt: number | null;
}

function generateVideoPath(): string {
  return path.join(root, ".codehq", "workflows", "generate-video.json");
}

async function readWorkflow(): Promise<MinimalWorkflowFile> {
  return JSON.parse(await fsp.readFile(generateVideoPath(), "utf-8")) as MinimalWorkflowFile;
}

async function writeWorkflow(workflow: MinimalWorkflowFile): Promise<void> {
  await fsp.writeFile(generateVideoPath(), `${JSON.stringify(workflow, null, 2)}\n`, "utf-8");
}

function withConnectedChain(workflow: MinimalWorkflowFile): MinimalWorkflowFile {
  const next = structuredClone(workflow);
  next.steps.push({
    id: NEW_NODE_ID,
    name: "Master Output",
    purpose: "Applies final color and audio mastering before delivery.",
    category: "logic",
    confidence: "verified",
  });
  next.connections.push({
    id: NEW_EDGE_ID,
    from: "save-result",
    to: NEW_NODE_ID,
  });
  return next;
}

function samplesForOperation(samples: PresenceCursorSample[], operation: string): PresenceCursorSample[] {
  return samples.filter((sample) => sample.operation === operation);
}

function firstAndLast(samples: PresenceCursorSample[]): [PresenceCursorSample, PresenceCursorSample] | null {
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (first === undefined || last === undefined || samples.length < 2) {
    return null;
  }
  return [first, last];
}

function displacementPx(first: PresenceCursorSample, last: PresenceCursorSample): number {
  return Math.hypot(last.x - first.x, last.y - first.y);
}

function largestOperationDisplacement(samples: PresenceCursorSample[]): { operation: string; pixels: number } | null {
  const grouped = new Map<string, PresenceCursorSample[]>();
  for (const sample of samples) {
    if (sample.operation === null) {
      continue;
    }
    const group = grouped.get(sample.operation) ?? [];
    group.push(sample);
    grouped.set(sample.operation, group);
  }

  let best: { operation: string; pixels: number } | null = null;
  for (const [operation, group] of grouped) {
    const ends = firstAndLast(group);
    if (ends === null) {
      continue;
    }
    const pixels = displacementPx(ends[0], ends[1]);
    if (best === null || pixels > best.pixels) {
      best = { operation, pixels };
    }
  }
  return best;
}

/**
 * Records pending / cursor / drawing mutations that can disappear before Playwright's next poll.
 * Must be installed after the board is up and before the workflow file is written.
 */
async function installPresenceProbe(page: Page, nodeId: string, edgeId: string): Promise<void> {
  await page.evaluate(
    ({ probedNodeId, probedEdgeId }) => {
      const existing = (window as unknown as { __hqPresenceProbe?: { stop: () => void } }).__hqPresenceProbe;
      existing?.stop();

      const emptyLog = (): PresenceLog => ({
        pendingHiddenNodeIds: [],
        nodePhases: [],
        nodeOperations: [],
        edgeStates: [],
        edgeOperations: [],
        edgePhases: [],
        cursorSamples: [],
        firstPendingHiddenAt: null,
        firstCursorNodeOpAt: null,
        firstCardVisibleAt: null,
        firstEdgeDrawingAt: null,
        firstCursorEdgeOpAt: null,
      });

      const log = emptyLog();

      const isHidden = (element: Element | null): boolean => {
        if (element === null) {
          return true;
        }
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden") {
          return true;
        }
        const opacity = Number.parseFloat(style.opacity);
        if (Number.isFinite(opacity) && opacity === 0) {
          return true;
        }
        const rect = element.getBoundingClientRect();
        return rect.width === 0 && rect.height === 0;
      };

      const remember = (list: string[], value: string | null): void => {
        if (value !== null && !list.includes(value)) {
          list.push(value);
        }
      };

      const snapshot = (): void => {
        const now = performance.now();
        const wrapper = document.querySelector(`.react-flow__node[data-id="${probedNodeId}"]`);
        const card = document.querySelector(`[data-step-node="${probedNodeId}"]`);
        const wrapperState = wrapper?.getAttribute("data-presence-state") ?? card?.getAttribute("data-presence-state");

        if (wrapperState === "pending" && (isHidden(wrapper) || isHidden(card))) {
          remember(log.pendingHiddenNodeIds, probedNodeId);
          log.firstPendingHiddenAt ??= now;
        }

        if (wrapper !== null && card !== null && !isHidden(wrapper) && !isHidden(card)) {
          log.firstCardVisibleAt ??= now;
        }

        const edge =
          document.querySelector(`.react-flow__edge[data-id="${probedEdgeId}"]`) ??
          document.querySelector(`[data-workflow-edge="${probedEdgeId}"]`) ??
          document.querySelector(`[data-workflow-edge][data-id="${probedEdgeId}"]`);
        const edgeState = edge?.getAttribute("data-presence-state");
        remember(log.edgeStates, edgeState ?? null);
        if (edgeState === "drawing") {
          log.firstEdgeDrawingAt ??= now;
        }

        const cursor = document.querySelector("[data-agent-cursor]");
        if (cursor === null) {
          return;
        }

        const operation = cursor.getAttribute("data-presence-operation");
        const phase = cursor.getAttribute("data-presence-phase");
        const style = getComputedStyle(cursor);
        const transform = (cursor as HTMLElement).style.transform || style.transform || "";
        const rect = cursor.getBoundingClientRect();
        if (log.cursorSamples.length < 400) {
          log.cursorSamples.push({
            operation,
            phase,
            transform,
            x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 2,
            time: now,
          });
        }

        if (operation === `node:${probedNodeId}`) {
          remember(log.nodeOperations, operation);
          remember(log.nodePhases, phase);
          if (phase === "moving" || phase === "revealing") {
            log.firstCursorNodeOpAt ??= now;
          }
        }

        if (operation === `edge:id:${probedEdgeId}` || operation?.startsWith(`edge:`) === true) {
          remember(log.edgeOperations, operation);
          remember(log.edgePhases, phase);
          if (operation === `edge:id:${probedEdgeId}`) {
            log.firstCursorEdgeOpAt ??= now;
          }
        }
      };

      const observer = new MutationObserver(snapshot);
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: [
          "data-presence-state",
          "data-presence-phase",
          "data-presence-operation",
          "data-agent-cursor",
          "style",
          "class",
          "transform",
        ],
      });

      let frame = requestAnimationFrame(function tick() {
        snapshot();
        frame = requestAnimationFrame(tick);
      });

      snapshot();
      (window as unknown as { __hqPresenceProbe: { log: PresenceLog; stop: () => void } }).__hqPresenceProbe = {
        log,
        stop: () => {
          observer.disconnect();
          cancelAnimationFrame(frame);
        },
      };
    },
    { probedNodeId: nodeId, probedEdgeId: edgeId },
  );
}

async function readPresenceLog(page: Page): Promise<PresenceLog> {
  return page.evaluate(() => {
    const probe = (window as unknown as { __hqPresenceProbe?: { log: PresenceLog } }).__hqPresenceProbe;
    if (probe === undefined) {
      throw new Error("Presence probe was not installed before the workflow write.");
    }
    return probe.log;
  });
}

test("a rename-only live update applies immediately and does not show an agent cursor", async ({ page }) => {
  await page.goto(server.url);
  await page.locator("[data-step-node]").first().waitFor({ state: "visible", timeout: 15_000 });
  await installPresenceProbe(page, NEW_NODE_ID, NEW_EDGE_ID);

  const original = await readWorkflow();
  const renamed = structuredClone(original);
  const receiveRequest = renamed.steps.find((step) => step.id === "receive-request");
  if (receiveRequest === undefined) {
    throw new Error("Fixture changed: expected a 'receive-request' step in generate-video.json.");
  }
  receiveRequest.name = "Receive Incoming Request";
  await writeWorkflow(renamed);

  await expect(page.locator('[data-step-node="receive-request"]')).toContainText("Receive Incoming Request", {
    timeout: 10_000,
  });
  await expect(page.getByText("Receive Request", { exact: true })).toHaveCount(0);
  await expect(page.locator("[data-agent-cursor]")).toHaveCount(0);

  const log = await readPresenceLog(page);
  expect(log.cursorSamples, "a rename must not mount [data-agent-cursor]").toHaveLength(0);
  expect(log.firstCursorNodeOpAt).toBeNull();
  expect(log.firstCursorEdgeOpAt).toBeNull();
});

test("a live connected-chain addition plays pending, cursor arrival, then edge drawing", async ({ page }) => {
  await page.goto(server.url);
  await page.locator("[data-step-node]").first().waitFor({ state: "visible", timeout: 15_000 });
  await expect(page.locator("[data-step-node]")).toHaveCount(11);
  await expect(page.locator(".react-flow__edge")).toHaveCount(10);

  const nodeWrapper = page.locator(`.react-flow__node[data-id="${NEW_NODE_ID}"]`);
  const card = page.locator(`[data-step-node="${NEW_NODE_ID}"]`);

  await installPresenceProbe(page, NEW_NODE_ID, NEW_EDGE_ID);
  await writeWorkflow(withConnectedChain(await readWorkflow()));

  // Observer + poll: pending/cursor/drawing can finish before the next Playwright locator check.
  await expect
    .poll(async () => (await readPresenceLog(page)).firstPendingHiddenAt, { timeout: 10_000 })
    .not.toBeNull();
  await expect
    .poll(async () => (await readPresenceLog(page)).firstCursorNodeOpAt, { timeout: 10_000 })
    .not.toBeNull();
  await expect.poll(async () => (await readPresenceLog(page)).firstCardVisibleAt, { timeout: 10_000 }).not.toBeNull();
  await expect
    .poll(async () => (await readPresenceLog(page)).firstEdgeDrawingAt, { timeout: 10_000 })
    .not.toBeNull();
  await expect
    .poll(async () => (await readPresenceLog(page)).firstCursorEdgeOpAt, { timeout: 10_000 })
    .not.toBeNull();

  const afterDrawing = await readPresenceLog(page);
  expect(afterDrawing.pendingHiddenNodeIds, "pending card exists but is initially hidden").toContain(NEW_NODE_ID);
  expect(afterDrawing.nodeOperations, "cursor operation targets the new node").toContain(NEW_NODE_OPERATION);
  expect(
    afterDrawing.nodePhases.some((phase) => phase === "moving" || phase === "revealing"),
    "node cursor phase moves or reveals",
  ).toBe(true);
  expect(afterDrawing.edgeStates, "edge enters drawing").toContain("drawing");
  expect(afterDrawing.edgeOperations, "cursor operation identifies the new edge").toContain(NEW_EDGE_OPERATION);
  expect(afterDrawing.edgePhases).toContain("drawing");
  expect(afterDrawing.firstPendingHiddenAt).not.toBeNull();
  expect(afterDrawing.firstCursorNodeOpAt).not.toBeNull();
  expect(afterDrawing.firstCardVisibleAt).not.toBeNull();
  expect(afterDrawing.firstPendingHiddenAt! <= afterDrawing.firstCursorNodeOpAt!).toBe(true);
  expect(
    afterDrawing.firstCursorNodeOpAt! <= afterDrawing.firstCardVisibleAt!,
    "card becomes visible only after cursor arrival",
  ).toBe(true);
  expect(afterDrawing.firstCardVisibleAt! <= afterDrawing.firstEdgeDrawingAt!).toBe(true);

  await expect
    .poll(async () => largestOperationDisplacement((await readPresenceLog(page)).cursorSamples), { timeout: 10_000 })
    .not.toBeNull();

  const movementLog = await readPresenceLog(page);
  const nodeSamples = samplesForOperation(movementLog.cursorSamples, NEW_NODE_OPERATION);
  const edgeSamples = samplesForOperation(movementLog.cursorSamples, NEW_EDGE_OPERATION);
  const edgeDrawingSamples = edgeSamples.filter((sample) => sample.phase === "drawing");
  const trackedEnds = firstAndLast(edgeDrawingSamples) ?? firstAndLast(edgeSamples) ?? firstAndLast(nodeSamples);
  expect(trackedEnds, "need at least two cursor transform/position samples during one presence operation").not.toBeNull();
  expect(displacementPx(trackedEnds![0], trackedEnds![1])).toBeGreaterThan(MIN_CURSOR_DISPLACEMENT_PX);

  const best = largestOperationDisplacement(movementLog.cursorSamples);
  expect(best, "cursor must move a non-trivial distance during one operation").not.toBeNull();
  expect(best!.pixels).toBeGreaterThan(MIN_CURSOR_DISPLACEMENT_PX);

  // An edge operation first repositions the cursor to its source. Check direction only during its
  // drawing phase; including that reposition leg would correctly point opposite the edge.
  const edgeEnds = firstAndLast(edgeDrawingSamples);
  if (edgeEnds !== null) {
    const sourceBox = await page.locator('[data-step-node="save-result"]').boundingBox();
    const targetBox = await card.boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(targetBox).not.toBeNull();
    const sourceX = sourceBox!.x + sourceBox!.width / 2;
    const sourceY = sourceBox!.y + sourceBox!.height / 2;
    const targetX = targetBox!.x + targetBox!.width / 2;
    const targetY = targetBox!.y + targetBox!.height / 2;
    const [first, last] = edgeEnds;
    const travelTowardTarget = (last.x - first.x) * (targetX - sourceX) + (last.y - first.y) * (targetY - sourceY);
    expect(travelTowardTarget, "edge cursor must travel from source toward target").toBeGreaterThan(0);
  }

  await expect(card).toBeVisible();
  await expect(nodeWrapper).toBeVisible();
  await expect(page.locator("[data-step-node]")).toHaveCount(12);
  await expect(page.locator(".react-flow__edge")).toHaveCount(11);
  await expect(card).toContainText("Master Output");

  const edgeFullyVisible = await page.evaluate((edgeId) => {
    const edge =
      document.querySelector(`.react-flow__edge[data-id="${edgeId}"]`) ??
      document.querySelector(`[data-workflow-edge="${edgeId}"]`);
    if (edge === null) {
      return false;
    }
    const style = getComputedStyle(edge);
    return style.visibility !== "hidden" && style.opacity !== "0" && style.display !== "none";
  }, NEW_EDGE_ID);
  expect(edgeFullyVisible, "the new edge must end fully visible").toBe(true);
});

test("reduced-motion live additions appear immediately and never show a cursor", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(server.url);
  await page.locator("[data-step-node]").first().waitFor({ state: "visible", timeout: 15_000 });
  await installPresenceProbe(page, NEW_NODE_ID, NEW_EDGE_ID);
  await writeWorkflow(withConnectedChain(await readWorkflow()));

  const card = page.locator(`[data-step-node="${NEW_NODE_ID}"]`);
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card).toContainText("Master Output");
  await expect(page.locator("[data-step-node]")).toHaveCount(12);
  await expect(page.locator(".react-flow__edge")).toHaveCount(11);
  await expect(page.locator("[data-agent-cursor]")).toHaveCount(0);

  const log = await readPresenceLog(page);
  expect(log.cursorSamples, "reduced-motion must not mount [data-agent-cursor]").toHaveLength(0);
  expect(log.firstCursorNodeOpAt).toBeNull();
  expect(log.firstCursorEdgeOpAt).toBeNull();
});
