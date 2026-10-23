import styles from "./StatusIndicator.module.css";

/** Connection + validation state, expressed as one indicator (contract §11 shell list). */
export type CodeHQStatus = "live" | "disconnected" | "invalid" | "stale";

export interface StatusIndicatorProps {
  status: CodeHQStatus;
  /** Rendered alongside the label when `status === "invalid"`. */
  errorCount?: number;
  /** Changes on every snapshot; each change sends one ping out of the dot. */
  pulseKey?: string;
}

const STATUS_META: Record<CodeHQStatus, { tone: "green" | "amber" | "red"; label: string }> = {
  live: { tone: "green", label: "Live" },
  disconnected: { tone: "amber", label: "Disconnected" },
  invalid: { tone: "red", label: "Invalid" },
  stale: { tone: "amber", label: "Stale" },
};

/**
 * A dot alone never carries the meaning (contract §11: no colour-only signalling) — the text
 * label is always rendered too.
 */
export function StatusIndicator({ status, errorCount, pulseKey }: StatusIndicatorProps) {
  const meta = STATUS_META[status];
  const label =
    status === "invalid" && errorCount !== undefined
      ? `${meta.label} · ${errorCount} ${errorCount === 1 ? "error" : "errors"}`
      : meta.label;

  return (
    <span className={styles.indicator} role="status">
      <span className={`${styles.dot} ${styles[meta.tone]} ${status === "live" ? styles.breathing : ""}`} aria-hidden="true">
        {pulseKey !== undefined ? <span key={pulseKey} className={styles.ping} /> : null}
      </span>
      <span className={styles.label}>{label}</span>
    </span>
  );
}
