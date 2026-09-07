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
    <StateLayout title="Map your repository">
      <p>
        Ask your coding agent to identify the important workflows and build an explorable repository map.
      </p>
      <div className={styles.actionRow}>
        <CopyButton value={AGENT_PROMPT} label="Map my repository" />
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
