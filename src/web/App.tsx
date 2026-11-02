import { useEffect, useRef, useState } from "react";
import { deleteWorkflow, recheck } from "./api/client";
import { useCodeHQSnapshot } from "./api/events";
import { IslandShell, type CodeHQStatus } from "./components/shell";
import { BehaviorCanvas, StepMoments } from "./components/behavior";
import { WorkflowNavigator, WorkflowRemovedNotice } from "./components/navigator";
import { EmptyState, ErrorState, LoadingState, UninitializedState } from "./components/states";
import { DiagnosticsBanner, DiagnosticsPanel } from "./components/diagnostics";
import { WorkflowCanvas } from "./components/canvas";
import { RepositoryOverview } from "./components/repository-map";
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

  const selectedWorkflowId = useCodeHQStore((state) => state.selectedWorkflowId);
  const selectWorkflow = useCodeHQStore((state) => state.selectWorkflow);
  const selectedBehaviorId = useCodeHQStore((state) => state.selectedBehaviorId);
  const selectBehavior = useCodeHQStore((state) => state.selectBehavior);
  const diagnosticsOpen = useCodeHQStore((state) => state.diagnosticsOpen);
  const toggleDiagnostics = useCodeHQStore((state) => state.toggleDiagnostics);
  const closeDiagnostics = useCodeHQStore((state) => state.closeDiagnostics);
  const [removedWorkflowName, setRemovedWorkflowName] = useState<string | null>(null);
  const lastShownWorkflow = useRef<{ id: string; name: string } | null>(null);
  const deletingWorkflowId = useRef<string | null>(null);

  useEffect(() => {
    if (snapshot === null) {
      return;
    }
    if (selectedBehaviorId !== null && snapshot.behaviors.some((record) => record.id === selectedBehaviorId)) {
      return;
    }
    const knownIds = new Set(snapshot.workflows.map((record) => record.id));
    const shown = snapshot.workflows.find((record) => record.id === selectedWorkflowId);
    if (shown !== undefined) {
      lastShownWorkflow.current = { id: shown.id, name: shown.workflow.name };
      return;
    }
    const lost = lastShownWorkflow.current;
    if (lost !== null && lost.id === selectedWorkflowId && deletingWorkflowId.current !== lost.id) {
      setRemovedWorkflowName(lost.name);
    }
    lastShownWorkflow.current = null;
    if (selectedWorkflowId === null && snapshot.repositoryMap !== null) {
      return;
    }
    const defaultId = snapshot.project?.settings?.defaultWorkflowId;
    const nextId = snapshot.repositoryMap !== null
      ? null
      : defaultId !== undefined && knownIds.has(defaultId) ? defaultId : snapshot.workflows[0]?.id;
    if (nextId === undefined && snapshot.behaviors[0] !== undefined) {
      selectBehavior(snapshot.behaviors[0].id);
      return;
    }
    selectWorkflow(nextId ?? null);
  }, [snapshot, selectedWorkflowId, selectedBehaviorId, selectWorkflow, selectBehavior]);

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
  const selectedBehavior = snapshot.behaviors.find((record) => record.id === selectedBehaviorId) ?? null;
  const invalidWorkflowIds = new Set(
    snapshot.repositoryMap?.repositoryMap.workflows
      .filter((workflow) => snapshot.diagnostics.issues.some((issue) =>
        issue.severity === "error" && issue.file.endsWith(`/workflows/${workflow.id}.json`),
      ))
      .map((workflow) => workflow.id) ?? [],
  );

  const handleRecheck = async (): Promise<void> => {
    await recheck();
    refetch();
  };

  if (selectedRecord === null && selectedBehavior === null && snapshot.repositoryMap === null) {
    return <EmptyState />;
  }

  return (
    <IslandShell
      repositoryName={snapshot.repository.name}
      locationLabel={selectedRecord?.workflow.name ?? selectedBehavior?.behavior.name ?? "Overview"}
      status={connectionStatus}
      pulseKey={snapshot.generatedAt}
      {...(connectionStatus === "invalid" ? { errorCount } : {})}
      navigator={(close) => (
        <WorkflowNavigator
          workflows={snapshot.workflows}
          repositoryName={snapshot.repository.name}
          repositoryMap={snapshot.repositoryMap}
          selectedWorkflowId={selectedWorkflowId}
          onSelect={(workflowId) => {
            selectWorkflow(workflowId);
            close();
          }}
          behaviors={snapshot.behaviors}
          selectedBehaviorId={selectedBehaviorId}
          onSelectBehavior={(behaviorId) => {
            selectBehavior(behaviorId);
            close();
          }}
        />
      )}
      notice={
        <>
          {removedWorkflowName !== null ? (
            <WorkflowRemovedNotice workflowName={removedWorkflowName} onDismiss={() => setRemovedWorkflowName(null)} />
          ) : null}
          <DiagnosticsBanner diagnostics={snapshot.diagnostics} workflows={snapshot.workflows} onOpenDiagnostics={toggleDiagnostics} />
        </>
      }
      overlays={
        <>
          {diagnosticsOpen ? (
            <DiagnosticsPanel diagnostics={snapshot.diagnostics} onClose={closeDiagnostics} onRecheck={handleRecheck} />
          ) : null}
          <CommandPalette snapshot={snapshot} onRecheck={handleRecheck} />
        </>
      }
    >
      {(chrome) => selectedRecord !== null ? (
        <WorkflowCanvas
          workflow={selectedRecord.workflow}
          sourceChecks={selectedRecord.sourceChecks}
          modifiedAt={selectedRecord.modifiedAt}
          state={selectedRecord.state}
          chrome={chrome}
          stepDetails={(stepId) => <StepMoments workflowId={selectedRecord.id} stepId={stepId} behaviors={snapshot.behaviors} />}
          onDeleteWorkflow={async () => {
            deletingWorkflowId.current = selectedRecord.workflow.id;
            await deleteWorkflow(selectedRecord.workflow.id);
            refetch();
          }}
        />
      ) : selectedBehavior !== null ? (
        <BehaviorCanvas record={selectedBehavior} workflows={snapshot.workflows} chrome={chrome} />
      ) : snapshot.repositoryMap !== null ? (
        <RepositoryOverview
          repositoryName={snapshot.repository.name}
          mapRecord={snapshot.repositoryMap}
          workflows={snapshot.workflows}
          invalidWorkflowIds={invalidWorkflowIds}
          onOpenWorkflow={selectWorkflow}
          chrome={chrome}
        />
      ) : null}
    </IslandShell>
  );
}
