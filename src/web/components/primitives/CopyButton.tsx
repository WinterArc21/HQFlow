import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, type ButtonProps } from "./Button";
import { copyToClipboard, type ClipboardOutcome } from "./clipboard";
import styles from "./CopyButton.module.css";

type CopyStatus = "idle" | ClipboardOutcome;

export interface CopyButtonProps {
  /** The exact text to copy. */
  value: string;
  label?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  /** Shown in place of the label, which then becomes the button's accessible name only. */
  icon?: ReactNode;
  /** Shown before the label. The label stays visible. */
  leadingIcon?: ReactNode;
}

const RESET_DELAY_MS = 1800;

/** What the live region announces. */
function statusText(status: CopyStatus): string | null {
  switch (status) {
    case "copied":
      return "Copied";
    case "manual-selection":
      return "Selected — press Ctrl+C";
    case "unavailable":
      return "Copy unavailable";
    case "idle":
      return null;
  }
}

/** The shorter word that takes the label's place inside the button. */
function swapText(status: CopyStatus): string {
  switch (status) {
    case "manual-selection":
      return "Press Ctrl+C";
    case "unavailable":
      return "Copy failed";
    default:
      return "Copied";
  }
}

function StatusIcon({ status }: { status: CopyStatus }) {
  if (status === "copied" || status === "idle") {
    return (
      <svg className={styles.tick} viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3 8.5 L6.5 12 L13 4.5" pathLength={1} />
      </svg>
    );
  }
  return (
    <svg className={styles.alert} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v3.5M8 11h0" />
    </svg>
  );
}

export function CopyButton({ value, label = "Copy", variant = "secondary", size = "sm", icon, leadingIcon }: CopyButtonProps) {
  const [status, setStatus] = useState<CopyStatus>("idle");
  const timeoutRef = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      if (timeoutRef.current !== undefined) {
        window.clearTimeout(timeoutRef.current);
      }
    },
    [],
  );

  const handleClick = (): void => {
    void copyToClipboard(value).then((outcome) => {
      if (timeoutRef.current !== undefined) {
        window.clearTimeout(timeoutRef.current);
      }
      setStatus(outcome);
      timeoutRef.current = window.setTimeout(() => setStatus("idle"), RESET_DELAY_MS);
    });
  };

  const swapIcon = icon ?? leadingIcon;

  return (
    <span>
      <Button
        variant={variant}
        size={size}
        onClick={handleClick}
        data-status={status}
        {...(icon !== undefined ? { "aria-label": label, title: label } : {})}
      >
        <span className={styles.content}>
          {swapIcon !== undefined ? (
            <span className={styles.swap} aria-hidden="true">
              <span className={styles.idle}>{swapIcon}</span>
              <span className={styles.done}>
                <StatusIcon status={status} />
              </span>
            </span>
          ) : null}
          {icon === undefined ? (
            <span className={styles.swap}>
              <span className={styles.idle}>{label}</span>
              <span className={styles.done} aria-hidden="true">
                {swapText(status)}
              </span>
            </span>
          ) : null}
        </span>
      </Button>
      <span className={styles.srOnly} role="status" aria-live="polite">
        {statusText(status)}
      </span>
    </span>
  );
}
