import { ChatTeardropText, MagnifyingGlass } from "@phosphor-icons/react";
import { searchShortcutLabel } from "../../lib/platform";
import { Button, Kbd } from "../primitives";
import { LocalOnlyBadge } from "./LocalOnlyBadge";
import { StatusIndicator, type CodeHQStatus } from "./StatusIndicator";
import styles from "./TopBar.module.css";
import { ThemeToggle } from "./ThemeToggle";

export interface TopBarProps {
  repositoryName: string;
  status: CodeHQStatus;
  errorCount?: number;
  onOpenSearch: () => void;
  onOpenAgentPrompt?: () => void;
}

export function TopBar({ repositoryName, status, errorCount, onOpenSearch, onOpenAgentPrompt }: TopBarProps) {
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
        {onOpenAgentPrompt !== undefined ? (
          <Button variant="secondary" size="sm" icon={<ChatTeardropText size={14} />} onClick={onOpenAgentPrompt}>
            Refine with agent
          </Button>
        ) : null}
        <ThemeToggle />
      </div>
    </div>
  );
}
