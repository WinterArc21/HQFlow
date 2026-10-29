import type { Workflow } from "@schema/workflow";
import type { WorkflowRecord } from "../../api/types";
import { countLabel } from "../../lib/pluralize";
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

/**
 * The workflow's name, size, purpose and freshness — shared by the title strip and the island shell.
 * The `data-title` parts let the shell lay them out as its pill and its open card.
 */
export function CanvasTitle({ workflow, itemLabel = "step", modifiedAt, state }: CanvasTitleProps) {
  return (
    <div className={styles.identity} data-title="">
      <div className={styles.titleRow} data-title="row">
        <h1 className={styles.name}>{workflow.name}</h1>
        <span className={styles.stepCount} data-title="steps">{countLabel(workflow.steps.length, itemLabel)}</span>
      </div>
      <div className={styles.detailsRow} data-title="details">
        <p className={styles.purpose} data-title="purpose">{workflow.purpose}</p>
        <div className={styles.trust} aria-label="Workflow freshness" data-title="trust" data-stale={state === "stale" ? "" : undefined}>
          {state === "stale" ? <Badge tone="amber">Stale</Badge> : null}
          {modifiedAt !== undefined ? (
            <span className={styles.freshness} data-title="updated">Updated {formatRelativeTime(modifiedAt)}</span>
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
