import { AGENT_PROMPT } from "../../lib/agentPrompt";
import { CopyButton } from "../primitives";
import { StateLayout } from "./StateLayout";
import styles from "./EmptyState.module.css";

/**
 * Initialized but no workflows exist yet. One real action: copy the mapping prompt for the
 * coding agent. The file watcher advances the canvas when `.codehq` files land — there is no
 * manual recheck on this screen.
 */
export function EmptyState() {
  return (
    <StateLayout title="Map your repository">
      <p>
        Ask your coding agent to identify the important workflows and build an explorable repository map.
      </p>
      <div className={styles.actionRow}>
        <CopyButton value={AGENT_PROMPT} label="Map my repository" />
      </div>
    </StateLayout>
  );
}
