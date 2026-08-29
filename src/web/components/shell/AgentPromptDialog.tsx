import { X } from "@phosphor-icons/react";
import { useId, useRef, useState } from "react";
import { composeWorkflowAgentPrompt, workflowFilePath, workflowMention } from "../../lib/agentPrompt";
import { useBackdropDismiss } from "../../lib/useBackdropDismiss";
import { useFocusTrap } from "../../lib/useFocusTrap";
import { Button, CopyButton, IconButton } from "../primitives";
import styles from "./AgentPromptDialog.module.css";

export interface AgentPromptDialogProps {
  workflowId: string;
  workflowName: string;
  onClose: () => void;
}

/** Composes a portable prompt for refining one selected workflow with any coding agent. */
export function AgentPromptDialog({ workflowId, workflowName, onClose }: AgentPromptDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const mention = workflowMention(workflowId);
  const filePath = workflowFilePath(workflowId);
  const [request, setRequest] = useState(`${mention} `);
  const [requestWorkflowId, setRequestWorkflowId] = useState(workflowId);

  // A live selection change gives the composer the new stable identity instead of retaining a
  // request that names the old workflow. Ordinary edits never pass through this reset path.
  if (requestWorkflowId !== workflowId) {
    setRequestWorkflowId(workflowId);
    setRequest(`${mention} `);
  }

  useFocusTrap(dialogRef, true, onClose);
  const backdropDismiss = useBackdropDismiss(onClose);
  const prompt = composeWorkflowAgentPrompt(workflowId, request);

  return (
    <div className={styles.backdrop} {...backdropDismiss}>
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Agent prompt</p>
            <h2 id={titleId} className={styles.title}>Refine {workflowName}</h2>
          </div>
          <IconButton label="Close agent prompt composer" icon={<X size={18} />} onClick={onClose} />
        </header>

        <div className={styles.body}>
          <p id={descriptionId} className={styles.intro}>
            Tell any coding agent what to change. HQFlow adds the stable mention and exact local file path when you copy.
          </p>

          <div className={styles.identityGrid}>
            <div className={styles.identityRow}>
              <div>
                <span className={styles.identityLabel}>Mention</span>
                <code>{mention}</code>
              </div>
              <CopyButton value={mention} label="Copy mention" variant="ghost" />
            </div>
            <div className={styles.identityRow}>
              <div>
                <span className={styles.identityLabel}>Workflow file</span>
                <code>{filePath}</code>
              </div>
              <CopyButton value={filePath} label="Copy path" variant="ghost" />
            </div>
          </div>

          <label className={styles.requestLabel} htmlFor={`${titleId}-request`}>Request</label>
          <textarea
            id={`${titleId}-request`}
            className={styles.request}
            rows={7}
            autoFocus
            value={request}
            onChange={(event) => setRequest(event.target.value)}
            placeholder={`${mention} is too bird's-eye; make it more detailed`}
          />
          <p className={styles.hint}>Your text is copied exactly as written.</p>
        </div>

        <footer className={styles.footer}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <CopyButton value={prompt} label="Copy final prompt" variant="primary" size="md" />
        </footer>
      </div>
    </div>
  );
}
