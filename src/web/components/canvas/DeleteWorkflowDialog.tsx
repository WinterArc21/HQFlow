import { X } from "@phosphor-icons/react";
import { useId, useRef } from "react";
import { useAsyncAction } from "../../lib/useAsyncAction";
import { useBackdropDismiss } from "../../lib/useBackdropDismiss";
import { useFocusTrap } from "../../lib/useFocusTrap";
import { Button, IconButton } from "../primitives";
import styles from "./DeleteWorkflowDialog.module.css";

export interface DeleteWorkflowDialogProps {
  workflowName: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

/** Confirmation dialog for the destructive removal of a workflow file. */
export function DeleteWorkflowDialog({ workflowName, onClose, onConfirm }: DeleteWorkflowDialogProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const confirm = useAsyncAction(onConfirm);
  const close = (): void => {
    if (confirm.status !== "pending") {
      onClose();
    }
  };
  useFocusTrap(containerRef, true, close);
  const backdropDismiss = useBackdropDismiss(close);

  return (
    <div className={styles.backdrop} {...backdropDismiss}>
      <div
        ref={containerRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <header className={styles.header}>
          <div>
            <h2 id={titleId} className={styles.title}>
              Delete workflow?
            </h2>
            <p className={styles.subtitle}>This action permanently removes the workflow file.</p>
          </div>
          <IconButton label="Close delete workflow dialog" icon={<X size={16} />} size="sm" onClick={close} disabled={confirm.status === "pending"} />
        </header>
        <div className={styles.body}>
          <p id={descriptionId}>
            Delete <strong className={styles.workflowName}>{workflowName}</strong>? This cannot be undone.
          </p>
          {confirm.status === "error" && confirm.message !== null ? (
            <p className={styles.error} role="alert">
              {confirm.message}
            </p>
          ) : null}
        </div>
        <footer className={styles.actions}>
          <Button variant="secondary" onClick={close} disabled={confirm.status === "pending"}>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirm.run} disabled={confirm.status === "pending"}>
            {confirm.status === "pending" ? "Deleting…" : "Delete workflow"}
          </Button>
        </footer>
      </div>
    </div>
  );
}
