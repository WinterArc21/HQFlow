import { Check } from "@phosphor-icons/react";
import type { WorkflowRecord } from "../../api/types";
import { formatRelativeTime } from "../../lib/relativeTime";
import { Badge } from "../primitives";
import styles from "./WorkflowListItem.module.css";

export interface WorkflowListItemProps {
  record: WorkflowRecord;
  selected: boolean;
  onSelect: () => void;
}

/**
 * One row. Selection is signalled three ways at once — a left border, bold text, and a
 * check icon — never by colour alone (contract §11), and via `aria-current` for assistive
 * tech.
 */
export function WorkflowListItem({ record, selected, onSelect }: WorkflowListItemProps) {
  return (
    <li>
      <button
        type="button"
        data-workflow-item
        className={`${styles.item} ${selected ? styles.selected : ""}`}
        aria-current={selected ? "true" : undefined}
        onClick={onSelect}
      >
        <div className={styles.main}>
          <div className={styles.headerRow}>
            <span className={styles.name}>{record.workflow.name}</span>
            {selected ? <Check size={14} weight="bold" className={styles.check} aria-hidden="true" /> : null}
          </div>
          <p className={styles.purpose}>{record.workflow.purpose}</p>
          <div className={styles.meta}>
            {record.state === "stale" ? <Badge tone="amber">Stale</Badge> : null}
            <span className={styles.stepCount}>{record.workflow.steps.length} steps</span>
            <span className={styles.time}>{formatRelativeTime(record.modifiedAt)}</span>
          </div>
        </div>
      </button>
    </li>
  );
}
