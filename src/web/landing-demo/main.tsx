import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Workflow } from "@schema/workflow";
import { Backdrop } from "../components/backdrop";
import { WorkflowCanvas } from "../components/canvas";
import { StepDrawer } from "../components/drawer";
import { ExportModeProvider } from "../export-viewer/ExportModeContext";
import { useCodeHQStore } from "../store/useCodeHQStore";
import workflowFixture from "../../../landing/hqflow-workflow.json";
import "../styles/tokens.css";
import "../styles/reset.css";
import "../styles/base.css";
import styles from "./LandingDemo.module.css";

const workflow = workflowFixture as unknown as Workflow;

/** `demo.html?live` is the hero reel: the agent cursors draw the map one step at a time, then start again. */
const LIVE = new URLSearchParams(window.location.search).has("live");
const STEP_MS = 1900;
const HOLD_MS = 5000;

function firstSteps(count: number): Workflow {
  const steps = workflow.steps.slice(0, count);
  const ids = new Set(steps.map((step) => step.id));
  return { ...workflow, steps, connections: workflow.connections.filter((c) => ids.has(c.from) && ids.has(c.to)) };
}

function useGrowingWorkflow(): Workflow {
  const [count, setCount] = useState(1);
  useEffect(() => {
    const full = count >= workflow.steps.length;
    const timer = window.setTimeout(() => setCount(full ? 1 : count + 1), full ? HOLD_MS : STEP_MS);
    return () => window.clearTimeout(timer);
  }, [count]);
  return useMemo(() => firstSteps(count), [count]);
}

function LiveReel() {
  const growing = useGrowingWorkflow();
  useEffect(() => {
    useCodeHQStore.setState({ theme: "dark", darkScene: "abyss-mesh", motion: "full", selectedStepId: null });
  }, []);
  return (
    <>
      <Backdrop />
      <main className={styles.app} data-live>
        <div className={styles.canvas}>
          <WorkflowCanvas workflow={growing} sourceChecks={{}} canvasId="landing-hero" />
        </div>
      </main>
    </>
  );
}

function LandingDemo() {
  const selectedStepId = useCodeHQStore((state) => state.selectedStepId);
  const selectStep = useCodeHQStore((state) => state.selectStep);

  useEffect(() => {
    useCodeHQStore.setState({ theme: "light", selectedStepId: null });
  }, []);

  return (
    <>
      <main className={styles.app}>
        <div className={styles.canvas}>
          <WorkflowCanvas workflow={workflow} sourceChecks={{}} />
        </div>
      </main>
      {selectedStepId !== null ? (
        <ExportModeProvider value={{ hideFilePaths: false }}>
          <StepDrawer
            workflow={workflow}
            stepId={selectedStepId}
            sourceChecks={{}}
            onClose={() => selectStep(null)}
          />
        </ExportModeProvider>
      ) : null}
    </>
  );
}

const container = document.getElementById("root");
if (container === null) {
  throw new Error("Landing demo root was not found.");
}

createRoot(container).render(
  <StrictMode>
    {LIVE ? <LiveReel /> : <LandingDemo />}
  </StrictMode>,
);
