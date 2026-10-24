import type { CanvasView } from "./layout";
import styles from "./CanvasViewHint.module.css";

const NAME: Record<CanvasView, string> = { flow: "Flow", wrap: "Wrap", line: "Line" };

export interface CanvasViewHintProps {
  view: CanvasView;
  suggestedView: CanvasView;
  onSwitch: () => void;
  onDismiss: () => void;
  /** Space covered by floating chrome at the bottom of the stage. */
  bottomInset?: number;
}

/** Shown when a live edit changes the map's shape: offers the better view instead of switching. */
export function CanvasViewHint({ view, suggestedView, onSwitch, onDismiss, bottomInset = 0 }: CanvasViewHintProps) {
  const reason = suggestedView === "flow" ? "This map has branches now." : "This map is a simple chain now.";
  return (
    <div className={styles.hint} role="status" style={{ bottom: bottomInset + 20 }}>
      <span className={styles.dot} aria-hidden="true" />
      <span className={styles.text}>
        {reason} <strong>{NAME[suggestedView]}</strong> shows it better.
      </span>
      <button type="button" className={styles.primary} onClick={onSwitch}>
        Switch to {NAME[suggestedView]}
      </button>
      <button type="button" className={styles.secondary} onClick={onDismiss}>
        Keep {NAME[view]}
      </button>
    </div>
  );
}
