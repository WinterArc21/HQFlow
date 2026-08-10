import { Moon, Sun } from "@phosphor-icons/react";
import { IconButton } from "../components/primitives";
import type { Theme } from "../store/useCodeHQStore";
import styles from "./ExportBanner.module.css";

export interface ExportBannerProps {
  workflowName: string;
  exportedAt: string;
  repositoryName: string;
  hideFilePaths: boolean;
  theme: Theme;
  onToggleTheme: () => void;
}

function formatTimestamp(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/**
 * The thin top bar of an exported snapshot: identifies the file as an HQFlow export,
 * shows the workflow name and generation timestamp, displays the privacy choice, and provides
 * the theme switcher as the snapshot's only extra control beyond the canvas.
 */
export function ExportBanner({
  workflowName,
  exportedAt,
  repositoryName,
  hideFilePaths,
  theme,
  onToggleTheme,
}: ExportBannerProps) {
  const nextTheme = theme === "dark" ? "light" : "dark";
  return (
    <div className={styles.banner}>
      <div className={styles.identity}>
        <div className={styles.titleRow}>
          <span className={styles.badge}>HQFlow Export</span>
          <span className={styles.name}>{workflowName}</span>
        </div>
        <span className={styles.timestamp}>{repositoryName} · {formatTimestamp(exportedAt)}</span>
      </div>
      <p className={styles.notice}>
        Snapshot of the agent-authored workflow description — not source code.
      </p>
      <div className={styles.actions}>
        <span className={`${styles.privacy} ${hideFilePaths ? styles.privacyHidden : styles.privacyIncluded}`}>
          {hideFilePaths ? "File paths hidden" : "File paths included"}
        </span>
        <IconButton
          label={`Switch to ${nextTheme} theme`}
          icon={theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          onClick={onToggleTheme}
        />
      </div>
    </div>
  );
}
