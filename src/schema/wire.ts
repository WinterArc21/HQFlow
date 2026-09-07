/** Browser-safe server/client wire contracts. This module must stay free of Node imports. */
import type { DiagnosticsReport } from "./diagnostics";
import type { CodeHQProject } from "./project";
import type { RepositoryMap } from "./repository-map";
import type { Workflow } from "./workflow";

export type SourceStatus = "found" | "missing";

export type CodeHQStatus = "uninitialized" | "empty" | "ready";

export interface WorkflowRecord {
  id: string;
  file: string;
  workflow: Workflow;
  modifiedAt: string;
  state: "valid" | "stale";
  staleSince?: string;
  /** Keyed by `${file}` or `${file}#${symbol}`. */
  sourceChecks: Record<string, SourceStatus>;
}

export interface RepositoryMapRecord {
  file: string;
  repositoryMap: RepositoryMap;
  modifiedAt: string;
  state: "valid" | "stale";
  staleSince?: string;
}

export interface RepositoryInfo {
  name: string;
  root: string;
  codeHQDir: string;
}

export interface CodeHQSnapshot {
  generatedAt: string;
  status: CodeHQStatus;
  repository: RepositoryInfo;
  project: CodeHQProject | null;
  repositoryMap: RepositoryMapRecord | null;
  workflows: WorkflowRecord[];
  diagnostics: DiagnosticsReport;
}

export interface CanvasPoint {
  x: number;
  y: number;
}

export type CanvasBendSnap = "source-x" | "target-x" | null;

export interface CanvasBend {
  point: CanvasPoint;
  snap: CanvasBendSnap;
}

/** Repository-local visual state for one workflow. Never stored in workflow JSON. */
export interface WorkflowCanvasLayout {
  nodePositions: Record<string, CanvasPoint>;
  edgeBends: Record<string, CanvasBend>;
}

/** `GET /api/source` response shape. It contains metadata only, never file contents. */
export interface SourceLookup {
  file: string;
  absolutePath: string;
  exists: boolean;
  editorUrl?: string;
  line?: number;
}

/** Sanitized data embedded in a self-contained workflow export. */
export interface ExportPayload {
  workflow: Workflow;
  sourceChecks: Record<string, SourceStatus>;
  hideFilePaths: boolean;
  workflowName: string;
  workflowId: string;
  exportedAt: string;
  repositoryName: string;
}
