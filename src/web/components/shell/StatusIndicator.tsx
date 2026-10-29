import { useEffect, useState } from "react";
import styles from "./StatusIndicator.module.css";

/** Connection + validation state, expressed as one indicator (contract §11 shell list). */
export type CodeHQStatus = "live" | "disconnected" | "invalid" | "stale";

export interface StatusIndicatorProps {
  status: CodeHQStatus;
  /** Rendered alongside the label when `status === "invalid"`. */
  errorCount?: number;
  /** Changes on every snapshot; each change washes the word once. */
  pulseKey?: string;
}

const STATUS_META: Record<CodeHQStatus, { tone: "green" | "amber" | "red"; label: string }> = {
  live: { tone: "green", label: "Live" },
  disconnected: { tone: "amber", label: "Disconnected" },
  invalid: { tone: "red", label: "Invalid" },
  stale: { tone: "amber", label: "Stale" },
};

/**
 * The word is the status. Tone tints it, and a snapshot washes it once. Colour never stands
 * alone (contract §11).
 */
export function StatusIndicator({ status, errorCount, pulseKey }: StatusIndicatorProps) {
  const meta = STATUS_META[status];
  const label =
    status === "invalid" && errorCount !== undefined
      ? `${meta.label} · ${errorCount} ${errorCount === 1 ? "error" : "errors"}`
      : meta.label;
  const [seenKey, setSeenKey] = useState(pulseKey);
  const arrived = pulseKey !== undefined && pulseKey !== seenKey;

  useEffect(() => {
    if (!arrived) {
      return;
    }
    const timer = window.setTimeout(() => setSeenKey(pulseKey), 700);
    return () => window.clearTimeout(timer);
  }, [arrived, pulseKey]);

  return (
    <span className={`${styles.indicator} ${styles[meta.tone]}`} role="status">
      <span className={`${styles.label} ${arrived ? styles.wash : ""}`}>{label}</span>
    </span>
  );
}
