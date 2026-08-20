import { useEffect, useState } from "react";
import { deleteWorkflow, recheck } from "./api/client";
import { useCodeHQSnapshot } from "./api/events";
import { AppShell, TopBar, type CodeHQStatus } from "./components/shell";
import { WorkflowNavigator } from "./components/navigator";
import { useFolders } from "./components/navigator/useFolders";
import { EmptyState, ErrorState, LoadingState, UninitializedState } from "./components/states";
import { DiagnosticsBanner, DiagnosticsPanel } from "./components/diagnostics";
import { WorkflowCanvas } from "./components/canvas";
import { StepDrawer } from "./components/drawer";
import { CommandPalette } from "./components/search";
import { useCodeHQStore } from "./store/useCodeHQStore";

function computeConnectionStatus(
  diagnosticsValid: boolean,
  hasStaleWorkflow: boolean,
  hookStatus: "loading" | "ready" | "error" | "disconnected",
): CodeHQStatus {
  if (!diagnosticsValid) {
    return "invalid";
  }
  if (hookStatus === "disconnected") {
    return "disconnected";
  }
  return hasStaleWorkflow ? "stale" : "live";
}

export function App() {
  const { snapshot, status, error, refetch } = useCodeHQSnapshot();
  const [workflowNavigatorCollapsed, setWorkflowNavigatorCollapsed] = useState(false);
  const folders = useFolders();

  const selectedWorkflowId = useCodeHQStore((state) => state.selectedWorkflowId);
  const selectWorkflow = useCodeHQStore((state) => state.selectWorkflow);
  const selectedStepId = useCodeHQStore((state) => state.selectedStepId);
  const selectStep = useCodeHQStore((state) => state.selectStep);
  const selectStepAndPan = useCodeHQStore((state) => state.selectStepAndPan);
  const openSearch = useCodeHQStore((state) => state.openSearch);
  const diagnosticsOpen = useCodeHQStore((state) => state.diagnosticsOpen);
  const toggleDiagnostics = useCodeHQStore((state) => state.toggleDiagnostics);
  const closeDiagnostics = useCodeHQStore((state) => state.closeDiagnostics);

  useEffect(() => {
    if (snapshot === null) {
      return;
    }
    const knownIds = new Set(snapshot.workflows.map((record) => record.id));
    if (selectedWorkflowId !== null && knownIds.has(selectedWorkflowId)) {
      return;
    }
    const defaultId = snapshot.project?.settings?.defaultWorkflowId;
    const nextId = defaultId !== undefined && knownIds.has(defaultId) ? defaultId : snapshot.workflows[0]?.id;
    selectWorkflow(nextId ?? null);
  }, [snapshot, selectedWorkflowId, selectWorkflow]);

  if (snapshot === null) {
    if (status === "error") {
      return <ErrorState message={error ?? "Unable to reach the HQFlow server."} onRetry={refetch} />;
    }
    return <LoadingState />;
  }

  if (snapshot.status === "uninitialized") {
    return <UninitializedState />;
  }

  const hasStaleWorkflow = snapshot.workflows.some((record) => record.state === "stale");
  const connectionStatus = computeConnectionStatus(snapshot.diagnostics.valid, hasStaleWorkflow, status);
  const errorCount = snapshot.diagnostics.issues.filter((issue) => issue.severity === "error").length;

  const selectedRecord = snapshot.workflows.find((record) => record.id === selectedWorkflowId) ?? null;
  const displayedWorkflow = selectedRecord?.workflow ?? null;
  const displayedSourceChecks = selectedRecord?.sourceChecks ?? {};

  const handleRecheck = async (): Promise<void> => {
    await recheck();
    refetch();
  };

  return (
    <>
      <AppShell
        asideCollapsed={workflowNavigatorCollapsed}
        topBar={
          <TopBar
            repositoryName={snapshot.repository.name}
            status={connectionStatus}
            {...(connectionStatus === "invalid" ? { errorCount } : {})}
            onOpenSearch={openSearch}
          />
        }
        aside={
          <WorkflowNavigator
            workflows={snapshot.workflows}
            selectedWorkflowId={selectedWorkflowId}
            onSelect={selectWorkflow}
            collapsed={workflowNavigatorCollapsed}
            onToggleCollapsed={() => setWorkflowNavigatorCollapsed((collapsed) => !collapsed)}
            folderState={folders.folderState}
            onCreateFolder={(name) => void folders.createFolder(name)}
            onRenameFolder={(folderId, name) => void folders.renameFolder(folderId, name)}
            onDeleteFolder={(folderId) => void folders.deleteFolder(folderId)}
            onAssignWorkflowToFolder={(workflowId, folderId) => void folders.assignWorkflowToFolder(workflowId, folderId)}
            onReorderFolder={(folderId, workflowIds) => void folders.reorderFolder(folderId, workflowIds)}
          />
        }
      >
        <DiagnosticsBanner diagnostics={snapshot.diagnostics} onOpenDiagnostics={toggleDiagnostics} />
        {selectedRecord !== null ? (
          <WorkflowCanvas
            workflow={selectedRecord.workflow}
            sourceChecks={selectedRecord.sourceChecks}
            modifiedAt={selectedRecord.modifiedAt}
            state={selectedRecord.state}
            onDeleteWorkflow={async () => {
              await deleteWorkflow(selectedRecord.workflow.id);
              refetch();
            }}
          />
        ) : (
          <EmptyState onRecheck={handleRecheck} />
        )}
      </AppShell>
      {displayedWorkflow !== null && selectedStepId !== null ? (
        <StepDrawer
          workflow={displayedWorkflow}
          stepId={selectedStepId}
          sourceChecks={displayedSourceChecks}
          onClose={() => selectStep(null)}
          onSelectStep={(stepId) => selectStepAndPan(displayedWorkflow.id, stepId)}
        />
      ) : null}
      {diagnosticsOpen ? (
        <DiagnosticsPanel diagnostics={snapshot.diagnostics} onClose={closeDiagnostics} onRecheck={handleRecheck} />
      ) : null}
      <CommandPalette snapshot={snapshot} onRecheck={handleRecheck} />
    </>
  );
}
