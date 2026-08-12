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
  status: CodeHQStatus;
  errorCount?: number;
  onOpenSearch: () => void;
}

export function TopBar({ repositoryName, status, errorCount, onOpenSearch }: TopBarProps) {
  return (
    <div className={styles.bar}>
      <div className={styles.left}>
        <span className={styles.repoName}>{repositoryName}</span>
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
