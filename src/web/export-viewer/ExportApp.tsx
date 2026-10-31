import { useEffect } from "react";
import { WorkflowCanvas } from "../components/canvas";
import { StepDrawer } from "../components/drawer";
import { useCodeHQStore } from "../store/useCodeHQStore";
import { ExportBanner } from "./ExportBanner";
import { ExportModeProvider } from "./ExportModeContext";
import type { ExportPayload } from "./types";
import styles from "./ExportApp.module.css";

export interface ExportAppProps {
  payload: ExportPayload;
}

/**
 * The export viewer's root: a thin export banner above the same `WorkflowCanvas` and
 * `StepDrawer` the live app uses, wrapped in an `ExportModeProvider` so server-only actions
 * (e.g. "Open in editor") are omitted and the server-provided privacy choice is applied.
 * All data is frozen in the embedded payload — no server, no SSE, no recheck.
 */
export function ExportApp({ payload }: ExportAppProps) {
  const hideFilePaths = payload.hideFilePaths === true;

  const theme = useCodeHQStore((state) => state.theme);
  const setTheme = useCodeHQStore((state) => state.setTheme);
  const selectedStepId = useCodeHQStore((state) => state.selectedStepId);
  const selectStep = useCodeHQStore((state) => state.selectStep);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  return (
    <ExportModeProvider value={{ hideFilePaths }}>
      <div className={styles.app}>
        <ExportBanner
          workflowName={payload.workflowName}
          exportedAt={payload.exportedAt}
          repositoryName={payload.repositoryName}
          hideFilePaths={hideFilePaths}
          theme={theme}
          onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
        />
        <div className={styles.canvas}>
          <WorkflowCanvas workflow={payload.workflow} sourceChecks={payload.sourceChecks} />
        </div>
      </div>
      {selectedStepId !== null ? (
        <StepDrawer
          workflow={payload.workflow}
          stepId={selectedStepId}
          sourceChecks={payload.sourceChecks}
          onClose={() => selectStep(null)}
        />
      ) : null}
    </ExportModeProvider>
  );
}
