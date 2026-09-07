import { useMemo } from "react";
import type { Workflow } from "@schema/workflow";
import type { RepositoryMapRecord, WorkflowRecord } from "../../api/types";
import { WorkflowCanvas } from "../canvas";

export interface RepositoryOverviewProps {
  repositoryName: string;
  mapRecord: RepositoryMapRecord;
  workflows: WorkflowRecord[];
  invalidWorkflowIds: ReadonlySet<string>;
  onOpenWorkflow: (workflowId: string) => void;
}

const REPOSITORY_MAP_CANVAS_ID = "__repository-map__";

export function RepositoryOverview({ repositoryName, mapRecord, workflows, invalidWorkflowIds, onOpenWorkflow }: RepositoryOverviewProps) {
  const recordsById = useMemo(() => new Map(workflows.map((record) => [record.id, record])), [workflows]);
  const mappedCount = mapRecord.repositoryMap.workflows.filter((workflow) => recordsById.has(workflow.id)).length;
  const incomingIds = useMemo(
    () => new Set(mapRecord.repositoryMap.connections.map((connection) => connection.to)),
    [mapRecord.repositoryMap.connections],
  );
  const overview = useMemo<Workflow>(() => ({
    schemaVersion: "0.1",
    id: "repository-overview",
    name: "Repository Overview",
    purpose: `${mappedCount} of ${mapRecord.repositoryMap.workflows.length} workflows mapped in ${repositoryName}.`,
    steps: mapRecord.repositoryMap.workflows.map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      purpose: workflow.purpose,
      category: incomingIds.has(workflow.id) ? "logic" : "entry",
      ...(workflow.entryPoint !== undefined ? { sources: [workflow.entryPoint] } : {}),
      ...(invalidWorkflowIds.has(workflow.id)
        ? { edgeCases: [{ name: "Invalid workflow map", description: "This workflow file has validation errors." }] }
        : {}),
    })),
    connections: mapRecord.repositoryMap.connections.map((connection, index) => ({
      id: `repository-handoff-${index}`,
      from: connection.from,
      to: connection.to,
      ...(connection.label !== undefined ? { label: connection.label } : {}),
      ...(connection.type !== undefined ? { type: connection.type } : {}),
    })),
  }), [incomingIds, invalidWorkflowIds, mapRecord.repositoryMap, mappedCount, repositoryName]);

  return (
    <WorkflowCanvas
      workflow={overview}
      sourceChecks={{}}
      canvasId={REPOSITORY_MAP_CANVAS_ID}
      itemLabel="workflows"
      exportEnabled={false}
      modifiedAt={mapRecord.modifiedAt}
      state={mapRecord.state}
      onNodeActivate={(workflowId) => {
        if (recordsById.has(workflowId)) onOpenWorkflow(workflowId);
      }}
    />
  );
}
