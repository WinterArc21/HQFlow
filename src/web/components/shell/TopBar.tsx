import { MagnifyingGlass } from "@phosphor-icons/react";
import { AGENT_PROMPT } from "../../lib/agentPrompt";
import { searchShortcutLabel } from "../../lib/platform";
import { CopyButton, Kbd } from "../primitives";
import { LocalOnlyBadge } from "./LocalOnlyBadge";
import { StatusIndicator, type CodeHQStatus } from "./StatusIndicator";
import styles from "./TopBar.module.css";
import { ThemeToggle } from "./ThemeToggle";

export interface TopBarProps {
  repositoryName: string;
  currentView?: string;
  onSelectRepository?: () => void;
  status: CodeHQStatus;
  errorCount?: number;
  onOpenSearch: () => void;
}

export function TopBar({ repositoryName, currentView, onSelectRepository, status, errorCount, onOpenSearch }: TopBarProps) {
  return (
    <div className={styles.bar}>
      <div className={styles.left}>
        {onSelectRepository !== undefined ? (
          <button type="button" className={styles.repoButton} onClick={onSelectRepository}>{repositoryName}</button>
        ) : <span className={styles.repoName}>{repositoryName}</span>}
        {currentView !== undefined ? <><span className={styles.separator}>/</span><span className={styles.currentView}>{currentView}</span></> : null}
      </div>

      <div className={styles.center}>
        <LocalOnlyBadge />
      </div>

      <div className={styles.right}>
        <StatusIndicator status={status} {...(errorCount !== undefined ? { errorCount } : {})} />
        <span className={styles.divider} aria-hidden="true" />
        <button type="button" className={styles.searchTrigger} onClick={onOpenSearch}>
          <MagnifyingGlass size={14} aria-hidden="true" />
          Search
          <Kbd>{searchShortcutLabel()}</Kbd>
        </button>
        <CopyButton value={AGENT_PROMPT} label="Copy agent prompt" />
        <ThemeToggle />
      </div>
    </div>
  );
}
