import { AGENT_PROMPT, AGENT_PROMPT_EXAMPLES } from "../../lib/agentPrompt";
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
      <div className={styles.examples}>
        <p className={styles.examplesTitle}>Try prompts like</p>
        {AGENT_PROMPT_EXAMPLES.map((prompt) => (
          <div className={styles.example} key={prompt}>
            <code>{prompt}</code>
            <CopyButton value={prompt} label="Copy example" size="sm" />
          </div>
        ))}
      </div>
      {recheck.status === "error" && recheck.message !== null ? (
        <p className={styles.actionError} role="alert">
          {recheck.message}
        </p>
      ) : null}
    </StateLayout>
  );
}
