/**
 * Browser-safe contracts for optional HQFlow accounts and cloud sync. The publishable key is
 * meant to ship in clients: row-level security in the database limits every user to their own
 * rows. Only `.codehq` workflow JSON, project settings, source-check status, and canvas layouts
 * sync. Repository source code never does.
 */
import type { CodeHQProject } from "./project";
import type { Workflow } from "./workflow";
import type { SourceStatus, WorkflowCanvasLayout } from "./wire";

export const HQFLOW_CLOUD_URL = "https://lqreqpinuqamgpnjxutl.supabase.co";
export const HQFLOW_CLOUD_PUBLISHABLE_KEY = "sb_publishable_n_aZWbzSwvGbXLYigvjRog_mRmsZ-9a";

/** One row of `public.synced_projects`. */
export interface SyncedProjectRow {
  id: string;
  owner_id: string;
  project_key: string;
  name: string;
  project: CodeHQProject;
  created_at: string;
  updated_at: string;
}

/** One row of `public.synced_workflows`. */
export interface SyncedWorkflowRow {
  project_id: string;
  owner_id: string;
  workflow_id: string;
  name: string;
  workflow: Workflow;
  workflow_hash: string;
  source_checks: Record<string, SourceStatus>;
  layout: WorkflowCanvasLayout | null;
  layout_hash: string | null;
  updated_at: string;
}
