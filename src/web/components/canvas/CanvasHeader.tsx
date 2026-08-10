import type { Workflow } from "@schema/workflow";
import type { WorkflowRecord } from "../../api/types";
import { statusTone } from "../../design/semantics";
import { formatRelativeTime } from "../../lib/relativeTime";
import { Badge } from "../primitives";
import { CanvasToolbar, type CanvasToolbarProps } from "./CanvasToolbar";
import styles from "./CanvasHeader.module.css";

export interface CanvasHeaderProps extends CanvasToolbarProps {
  workflow: Workflow;
  modifiedAt?: WorkflowRecord["modifiedAt"];
  state?: WorkflowRecord["state"];
}

/** The canvas title strip and its remaining zoom/collapse actions. */
export function CanvasHeader({ workflow, modifiedAt, state, ...toolbarProps }: CanvasHeaderProps) {
  const status = statusTone(workflow.status);

  return (
    <div className={styles.header}>
      <div className={styles.identity}>
        <div className={styles.titleRow}>
          <h1 className={styles.name}>{workflow.name}</h1>
          <span className={styles.stepCount}>{workflow.steps.length} steps</span>
        </div>
        <div className={styles.detailsRow}>
          <p className={styles.purpose}>{workflow.purpose}</p>
          <div className={styles.trust} aria-label="Workflow status and freshness">
            <Badge tone={status.tone}>{status.label}</Badge>
            {state === "stale" ? <Badge tone="amber">Stale</Badge> : null}
            {modifiedAt !== undefined ? (
              <span className={styles.freshness}>Updated {formatRelativeTime(modifiedAt)}</span>
            ) : null}
          </div>
        </div>
      </div>
      <CanvasToolbar {...toolbarProps} />
    </div>
  );
}
