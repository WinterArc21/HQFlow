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
}

const RESET_DELAY_MS = 1800;

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

export function CopyButton({ value, label = "Copy", variant = "secondary", size = "sm", icon }: CopyButtonProps) {
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
      setStatus(outcome);
      timeoutRef.current = window.setTimeout(() => setStatus("idle"), RESET_DELAY_MS);
    });
  };

  const text = statusText(status);
  const toneClass = status === "copied" ? styles.copied : status === "unavailable" ? styles.failed : "";

  return (
    <span>
      <Button
        variant={variant}
        size={size}
        onClick={handleClick}
        data-copied={status === "copied" ? "true" : undefined}
        {...(icon !== undefined ? { "aria-label": label, title: label } : {})}
      >
        <span className={styles.labelSwap}>
          <span className={styles.label} aria-hidden={icon !== undefined ? "true" : undefined}>{icon ?? label}</span>
          <svg className={styles.tick} viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3 8.5 L6.5 12 L13 4.5" pathLength={1} />
          </svg>
        </span>
      </Button>
      <span className={`${styles.status} ${toneClass}`} role="status" aria-live="polite">
        {text}
      </span>
    </span>
  );
}
