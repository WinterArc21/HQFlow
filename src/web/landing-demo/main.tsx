import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { CodeHQSnapshot } from "@schema/wire";
import type { Workflow } from "@schema/workflow";
import { Backdrop } from "../components/backdrop";
import { WorkflowCanvas } from "../components/canvas";
import { WorkflowNavigator } from "../components/navigator";
import { CommandPalette } from "../components/search";
import { IslandShell } from "../components/shell";
import { useCodeHQStore } from "../store/useCodeHQStore";
import workflowFixture from "../../../landing/hqflow-workflow.json";
import "../styles/tokens.css";
import "../styles/reset.css";
import "../styles/base.css";
import styles from "./LandingDemo.module.css";

const workflow = workflowFixture as unknown as Workflow;

/** A frozen snapshot of one repository with this one workflow, so the demo runs the app's own shell. */
const snapshot: CodeHQSnapshot = {
  generatedAt: "2026-01-01T00:00:00.000Z",
  status: "ready",
  repository: { name: "hqflow", root: "", codeHQDir: ".codehq" },
  project: null,
  repositoryMap: null,
  workflows: [{
    id: workflow.id,
    file: `.codehq/workflows/${workflow.id}.json`,
    workflow,
    modifiedAt: "2026-01-01T00:00:00.000Z",
    state: "valid",
    sourceChecks: {},
  }],
  diagnostics: { generatedAt: "2026-01-01T00:00:00.000Z", valid: true, issues: [] },
};

/**
 * `demo.html?live` is the landing page canvas: the agent cursors draw the map one step at a time,
 * then the full map stays for the feature tour. The page sends `replay` and `finish`; the demo
 * answers `drawn` when the map is complete and `export` when the visitor presses the dock's export. The plain `demo.html` (the HTML export) shows the map at once.
 */
const LIVE = new URLSearchParams(window.location.search).has("live");
const MESSAGE = "hqflow-demo";
const STEP_MS = 1900;

function firstSteps(count: number): Workflow {
  const steps = workflow.steps.slice(0, count);
  const ids = new Set(steps.map((step) => step.id));
  return { ...workflow, steps, connections: workflow.connections.filter((c) => ids.has(c.from) && ids.has(c.to)) };
}

function useDrawing(): { shown: Workflow; drawing: boolean } {
  const total = workflow.steps.length;
  const [count, setCount] = useState(LIVE ? 1 : total);
  const drawing = count < total;

  useEffect(() => {
    if (!LIVE) return;
    if (!drawing) {
      window.parent.postMessage({ type: MESSAGE, event: "drawn" }, window.location.origin);
      return;
    }
    const timer = window.setTimeout(() => setCount(count + 1), STEP_MS);
    return () => window.clearTimeout(timer);
  }, [count, drawing]);

  useEffect(() => {
    if (!LIVE) return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.type !== MESSAGE) return;
      if (event.data.command === "replay") {
        useCodeHQStore.getState().selectStep(null);
        setCount(1);
      } else if (event.data.command === "finish") {
        setCount(total);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [total]);

  // The app's export needs its local server; the landing page's own export dialog works offline.
  useEffect(() => {
    if (!LIVE) return;
    const onClick = (event: MouseEvent) => {
      if (!event.isTrusted || !(event.target instanceof Element) || event.target.closest('button[aria-label="Export canvas"]') === null) return;
      event.preventDefault();
      event.stopPropagation();
      window.parent.postMessage({ type: MESSAGE, event: "export" }, window.location.origin);
    };
    window.addEventListener("click", onClick, { capture: true });
    return () => window.removeEventListener("click", onClick, { capture: true });
  }, []);

  // Reaching into the canvas mid-draw means the visitor wants to explore now.
  useEffect(() => {
    if (!drawing) return;
    const finish = () => setCount(total);
    window.addEventListener("pointerdown", finish, { capture: true, once: true });
    return () => window.removeEventListener("pointerdown", finish, { capture: true });
  }, [drawing, total]);

  return { shown: useMemo(() => firstSteps(count), [count]), drawing };
}

function LandingDemo() {
  const { shown, drawing } = useDrawing();

  useEffect(() => {
    useCodeHQStore.setState({
      ...(LIVE ? { theme: "dark", darkScene: "abyss-mesh", motion: "full" } : { theme: "light" }),
      selectedWorkflowId: workflow.id,
      selectedStepId: null,
    });
  }, []);

  return (
    <>
      <Backdrop />
      <div className={styles.app} data-live={drawing || undefined}>
        <IslandShell
          repositoryName={snapshot.repository.name}
          locationLabel={workflow.name}
          status="live"
          navigator={(close) => (
            <WorkflowNavigator
              workflows={snapshot.workflows}
              repositoryName={snapshot.repository.name}
              selectedWorkflowId={workflow.id}
              onSelect={close}
            />
          )}
          overlays={<CommandPalette snapshot={snapshot} onRecheck={async () => {}} />}
        >
          {(chrome) => <WorkflowCanvas workflow={shown} sourceChecks={{}} chrome={chrome} />}
        </IslandShell>
      </div>
    </>
  );
}

const container = document.getElementById("root");
if (container === null) {
  throw new Error("Landing demo root was not found.");
}

createRoot(container).render(
  <StrictMode>
    <LandingDemo />
  </StrictMode>,
);
