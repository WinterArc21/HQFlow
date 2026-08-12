/** Browser-safe server/client wire contracts. This module must stay free of Node imports. */
import type { DiagnosticsReport } from "./diagnostics";
import type { CodeHQProject } from "./project";
import type { Workflow } from "./workflow";

export type SourceStatus = "verified" | "file-only" | "missing";

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
  workflows: WorkflowRecord[];
  diagnostics: DiagnosticsReport;
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
