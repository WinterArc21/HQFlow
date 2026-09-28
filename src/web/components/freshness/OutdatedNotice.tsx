import { ClockCounterClockwise } from "@phosphor-icons/react";
import type { WorkflowRecord } from "../../api/types";
import { recheckOutdatedStepsPrompt } from "../../lib/agentPrompt";
import { useAsyncAction } from "../../lib/useAsyncAction";
import { Button, CopyButton } from "../primitives";
import styles from "./OutdatedNotice.module.css";

const MAX_LISTED_FILES = 3;

export interface OutdatedNoticeProps {
  record: WorkflowRecord;
  onMarkCurrent: () => Promise<void>;
}

/**
 * Says which steps point at code that changed after the workflow was written, and offers the two
 * ways out: hand the agent a prompt that re-checks exactly those steps, or accept the current code
 * as already described. Renders nothing while every step is current.
 */
export function OutdatedNotice({ record, onMarkCurrent }: OutdatedNoticeProps) {
  const markCurrent = useAsyncAction(onMarkCurrent);
  const outdatedSteps = record.freshness?.outdatedSteps ?? {};
  const stepCount = Object.keys(outdatedSteps).length;
  if (stepCount === 0) {
    return null;
  }

  const files = [...new Set(Object.values(outdatedSteps).flat().map((changed) => changed.file))].sort();
  const listed = files.slice(0, MAX_LISTED_FILES);
  const hidden = files.length - listed.length;

  return (
    <section className={styles.notice} aria-label="Outdated steps" data-outdated-notice>
      <p className={styles.headline}>
        <ClockCounterClockwise size={16} aria-hidden="true" />
        <strong>
          {stepCount} {stepCount === 1 ? "step" : "steps"} may be outdated
        </strong>
      </p>
      <p className={styles.detail}>
        {listed.map((file, index) => (
          <span key={file}>
            {index > 0 ? ", " : null}
            <code className={styles.file}>{file}</code>
          </span>
        ))}
        {hidden > 0 ? ` and ${hidden} more` : null} changed since this map was written.
      </p>
      <div className={styles.actions}>
        <CopyButton value={recheckOutdatedStepsPrompt(record)} label="Copy prompt for your agent" variant="primary" />
        <Button variant="ghost" size="sm" onClick={markCurrent.run} disabled={markCurrent.status === "pending"}>
          Mark as up to date
        </Button>
      </div>
      {markCurrent.status === "error" && markCurrent.message !== null ? (
        <p className={styles.error} role="alert">
          {markCurrent.message}
        </p>
      ) : null}
    </section>
  );
}
