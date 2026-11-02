import { Check } from "@phosphor-icons/react";
import { countLabel } from "../../lib/pluralize";
import { Badge } from "../primitives";
import styles from "./WorkflowListItem.module.css";

export interface WorkflowListItemProps {
  name: string;
  stale: boolean;
  /** How many steps (or, for a behavior, moments) the item has. */
  count: number;
  countNoun?: string;
  /** Behaviors mark their rows separately, so tests and helpers can tell the two lists apart. */
  kind?: "workflow" | "behavior";
  selected: boolean;
  onSelect: () => void;
}

/**
 * One compact row: the name, a stale badge, and the size. Selection is signalled three ways at
 * once — a left bar, bold text, and a check icon — never by colour alone (contract §11), and via
 * `aria-current` for assistive tech.
 */
export function WorkflowListItem({ name, stale, count, countNoun = "step", kind = "workflow", selected, onSelect }: WorkflowListItemProps) {
  return (
    <li>
      <button
        type="button"
        data-workflow-item={kind === "workflow" ? "" : undefined}
        data-behavior-item={kind === "behavior" ? "" : undefined}
        data-navigation-item
        className={`${styles.item} ${selected ? styles.selected : ""}`}
        aria-current={selected ? "true" : undefined}
        onClick={onSelect}
      >
        <span className={styles.name}>{name}</span>
        {stale ? <Badge tone="amber">Stale</Badge> : null}
        {selected ? <Check size={14} weight="bold" className={styles.check} aria-hidden="true" /> : null}
        <span className={styles.stepCount}>{countLabel(count, countNoun)}</span>
      </button>
    </li>
  );
}
