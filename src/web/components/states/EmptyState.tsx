import { AGENT_PROMPT } from "../../lib/agentPrompt";
import { useAsyncAction } from "../../lib/useAsyncAction";
import { Button, CopyButton } from "../primitives";
import { StateLayout } from "./StateLayout";
import styles from "./EmptyState.module.css";

export interface EmptyStateProps {
  onRecheck: () => Promise<void>;
}

/**
 * Initialized but no workflows exist yet. Three real, working actions — no embedded chat box
 * (contract §12: no fake buttons).
 */
export function EmptyState({ onRecheck }: EmptyStateProps) {
  const recheck = useAsyncAction(onRecheck);

  return (
    <StateLayout title="No workflows mapped yet">
      <p>
        Ask your coding agent to read <code>.codehq/SKILL.md</code> and map a product workflow.
      </p>
      <div className={styles.actionRow}>
        <CopyButton value={AGENT_PROMPT} label="Copy prompt" />
        <Button variant="secondary" size="sm" onClick={recheck.run}>
          Recheck files
        </Button>
      </div>
      {recheck.status === "error" && recheck.message !== null ? (
        <p className={styles.actionError} role="alert">
          {recheck.message}
        </p>
      ) : null}
    </StateLayout>
  );
}
