import { Check } from "@phosphor-icons/react";
import type { WorkflowRecord } from "../../api/types";
import { countLabel } from "../../lib/pluralize";
import { Badge } from "../primitives";
import styles from "./WorkflowListItem.module.css";

export interface WorkflowListItemProps {
  record: WorkflowRecord;
  selected: boolean;
  onSelect: () => void;
}

/**
 * One compact row: the name, a stale badge, and the size. Selection is signalled three ways at
 * once — a left bar, bold text, and a check icon — never by colour alone (contract §11), and via
 * `aria-current` for assistive tech.
 */
export function WorkflowListItem({ record, selected, onSelect }: WorkflowListItemProps) {
  return (
    <li>
      <button
        type="button"
        data-workflow-item
        data-navigation-item
        className={`${styles.item} ${selected ? styles.selected : ""}`}
        aria-current={selected ? "true" : undefined}
        onClick={onSelect}
      >
        <span className={styles.name}>{record.workflow.name}</span>
        {record.state === "stale" ? <Badge tone="amber">Stale</Badge> : null}
        {selected ? <Check size={14} weight="bold" className={styles.check} aria-hidden="true" /> : null}
        <span className={styles.stepCount}>{countLabel(record.workflow.steps.length, "step")}</span>
      </button>
    </li>
  );
}
