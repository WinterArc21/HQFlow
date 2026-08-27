import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import type { Workflow } from "@schema/workflow";
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

function LandingDemo() {
  const selectedStepId = useCodeHQStore((state) => state.selectedStepId);
  const selectStep = useCodeHQStore((state) => state.selectStep);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "light");
    useCodeHQStore.setState({ theme: "light", selectedStepId: null, expandedStepIds: {} });
  }, []);

  return (
    <>
      <main className={styles.app}>
        <header className={styles.topbar}>
          <div className={styles.brand}>
            <span className={styles.mark} aria-hidden="true">H</span>
            <strong>HQFlow</strong>
            <span className={styles.repo}>hqflow / how-hqflow-works</span>
          </div>
          <span className={styles.live}><span aria-hidden="true" /> playable demo</span>
        </header>
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
            onSelectStep={selectStep}
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
    <LandingDemo />
  </StrictMode>,
);
