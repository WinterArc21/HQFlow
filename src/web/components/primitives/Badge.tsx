import type { ReactNode } from "react";
import type { BadgeTone } from "../../design/semantics";
import styles from "./Badge.module.css";

export interface BadgeProps {
  tone?: BadgeTone;
  /** A small leading dot in the tone colour — used where colour must be paired with a shape. */
  dot?: boolean;
  className?: string | undefined;
  children: ReactNode;
}

export function Badge({ tone = "neutral", dot = false, className, children }: BadgeProps) {
  const classNames = [styles.badge, styles[tone], className];
  return (
    <span className={classNames.filter(Boolean).join(" ")}>
      {dot ? <span className={styles.dot} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
