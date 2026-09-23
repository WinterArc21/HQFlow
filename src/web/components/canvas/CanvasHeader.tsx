import type { Workflow } from "@schema/workflow";
import type { WorkflowRecord } from "../../api/types";
import { formatRelativeTime } from "../../lib/relativeTime";
import { Badge } from "../primitives";
import { CanvasToolbar, type CanvasToolbarProps } from "./CanvasToolbar";
import styles from "./CanvasHeader.module.css";

export interface CanvasHeaderProps extends CanvasToolbarProps {
  workflow: Workflow;
  itemLabel?: string;
  modifiedAt?: WorkflowRecord["modifiedAt"];
  state?: WorkflowRecord["state"];
}

export interface CanvasTitleProps {
  workflow: Workflow;
  itemLabel?: string;
  modifiedAt?: WorkflowRecord["modifiedAt"];
  state?: WorkflowRecord["state"];
}

/** The workflow's name, size, purpose and freshness — shared by the title strip and the island shell. */
export function CanvasTitle({ workflow, itemLabel = "steps", modifiedAt, state }: CanvasTitleProps) {
  return (
    <div className={styles.identity}>
      <div className={styles.titleRow}>
        <h1 className={styles.name}>{workflow.name}</h1>
        <span className={styles.stepCount}>{workflow.steps.length} {itemLabel}</span>
      </div>
      <div className={styles.detailsRow}>
        <p className={styles.purpose}>{workflow.purpose}</p>
        <div className={styles.trust} aria-label="Workflow freshness">
          {state === "stale" ? <Badge tone="amber">Stale</Badge> : null}
          {modifiedAt !== undefined ? (
            <span className={styles.freshness}>Updated {formatRelativeTime(modifiedAt)}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** The canvas title strip and its remaining zoom/collapse actions. */
export function CanvasHeader({ workflow, itemLabel, modifiedAt, state, ...toolbarProps }: CanvasHeaderProps) {
  return (
    <div className={styles.header}>
      <CanvasTitle
        workflow={workflow}
        {...(itemLabel !== undefined ? { itemLabel } : {})}
        {...(modifiedAt !== undefined ? { modifiedAt } : {})}
        {...(state !== undefined ? { state } : {})}
      />
      <CanvasToolbar {...toolbarProps} />
    </div>
  );
}
