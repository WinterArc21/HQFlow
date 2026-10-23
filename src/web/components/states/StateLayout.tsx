import type { ReactNode } from "react";
import styles from "./StateLayout.module.css";

export interface StateLayoutProps {
  icon?: ReactNode;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  /** Decorative art above the title. */
  hero?: ReactNode;
}

/** Shared centred-card layout for the four full-page states. */
export function StateLayout({ icon, title, children, actions, hero }: StateLayoutProps) {
  return (
    <div className={styles.layout}>
      <div className={styles.card}>
        {hero !== undefined ? <div className={styles.hero}>{hero}</div> : null}
        {icon !== undefined ? (
          <div className={styles.icon} aria-hidden="true">
            {icon}
          </div>
        ) : null}
        <h2 className={styles.title}>{title}</h2>
        <div className={styles.body}>{children}</div>
        {actions !== undefined ? <div className={styles.actions}>{actions}</div> : null}
      </div>
    </div>
  );
}
