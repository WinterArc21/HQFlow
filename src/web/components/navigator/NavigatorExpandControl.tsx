import { CaretRight } from "@phosphor-icons/react";
import styles from "./WorkflowNavigator.module.css";

export interface NavigatorExpandControlProps {
  onExpand: () => void;
}

/** Canvas overlay used when the navigator is collapsed to a 1px hairline. */
export function NavigatorExpandControl({ onExpand }: NavigatorExpandControlProps) {
  return (
    <button
      type="button"
      className={styles.expandOnCanvas}
      aria-label="Expand workflows rail"
      title="Expand workflows rail"
      onClick={onExpand}
    >
      <CaretRight size={16} weight="bold" aria-hidden="true" />
    </button>
  );
}
