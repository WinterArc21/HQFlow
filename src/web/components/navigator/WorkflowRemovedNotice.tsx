import { Info, X } from "@phosphor-icons/react";
import { IconButton } from "../primitives";
import styles from "./WorkflowRemovedNotice.module.css";

export interface WorkflowRemovedNoticeProps {
  workflowName: string;
  onDismiss: () => void;
}

/** Explains why the canvas just switched: the workflow that was open no longer exists on disk. */
export function WorkflowRemovedNotice({ workflowName, onDismiss }: WorkflowRemovedNoticeProps) {
  return (
    <div className={styles.notice} role="status">
      <div className={styles.text}>
        <Info size={16} aria-hidden="true" />
        <span>
          <strong>“{workflowName}” was removed</strong> — its file is no longer in .codehq/workflows/, so another
          workflow is shown instead.
        </span>
      </div>
      <IconButton label="Dismiss" icon={<X size={14} />} size="sm" onClick={onDismiss} />
    </div>
  );
}
