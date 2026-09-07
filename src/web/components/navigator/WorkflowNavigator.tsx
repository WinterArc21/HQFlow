import { CaretLeft, CaretRight, CirclesFour, Folder, GitBranch } from "@phosphor-icons/react";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import type { RepositoryMapRecord, WorkflowRecord } from "../../api/types";
import { ANOTHER_WORKFLOW_PROMPT } from "../../lib/agentPrompt";
import { CopyButton, SectionLabel } from "../primitives";
import { WorkflowListItem } from "./WorkflowListItem";
import styles from "./WorkflowNavigator.module.css";

export interface WorkflowNavigatorProps {
  workflows: WorkflowRecord[];
  repositoryName?: string;
  repositoryMap?: RepositoryMapRecord | null;
  selectedWorkflowId: string | null;
  onSelect: (workflowId: string | null) => void;
  /** Controlled by App for the shell grid; omitted for a self-contained navigator. */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

/**
 * A plain, fully-tabbable button list (Tab/Shift+Tab + Enter/Space work natively) with an
 * Up/Down arrow-key convenience layered on top via DOM focus movement — deliberately not an
 * ARIA `listbox`, since a partial listbox implementation is worse than a correct plain list
 * (contract §11).
 *
 * When a repository map exists, the rail is a file tree: the repository folder is Overview,
 * and each workflow hangs off the same spine.
 */
export function WorkflowNavigator({
  workflows,
  repositoryName,
  repositoryMap,
  selectedWorkflowId,
  onSelect,
  collapsed,
  onToggleCollapsed,
}: WorkflowNavigatorProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const [uncontrolledCollapsed, setUncontrolledCollapsed] = useState(false);
  const isCollapsed = collapsed ?? uncontrolledCollapsed;
  const hasRepositoryMap = repositoryMap !== undefined && repositoryMap !== null;
  const overviewSelected = hasRepositoryMap && selectedWorkflowId === null;
  const definitions = hasRepositoryMap
    ? repositoryMap.repositoryMap.workflows
    : workflows.map((record) => ({
        id: record.id,
        name: record.workflow.name,
        purpose: record.workflow.purpose,
      }));

  const handleToggleCollapsed = (): void => {
    if (onToggleCollapsed !== undefined) {
      onToggleCollapsed();
      return;
    }
    setUncontrolledCollapsed((current) => !current);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLUListElement>): void => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-navigation-item]") ?? []);
    const currentIndex = buttons.findIndex((button) => button === document.activeElement);
    if (currentIndex === -1) {
      return;
    }
    event.preventDefault();
    const nextIndex = event.key === "ArrowDown" ? Math.min(currentIndex + 1, buttons.length - 1) : Math.max(currentIndex - 1, 0);
    buttons[nextIndex]?.focus();
  };

  return (
    <nav className={`${styles.navigator} ${isCollapsed ? styles.collapsed : ""}`} aria-label="Repository navigation">
      <div className={styles.header}>
        {isCollapsed ? null : <SectionLabel as="h2">Navigator</SectionLabel>}
        <button
          type="button"
          className={styles.toggle}
          aria-controls={listId}
          aria-expanded={!isCollapsed}
          aria-label={isCollapsed ? "Expand workflows rail" : "Collapse workflows rail"}
          title={isCollapsed ? "Expand workflows rail" : "Collapse workflows rail"}
          onClick={handleToggleCollapsed}
        >
          {isCollapsed ? <CaretRight size={16} weight="bold" aria-hidden="true" /> : <CaretLeft size={16} weight="bold" aria-hidden="true" />}
        </button>
      </div>
      <div id={listId} className={styles.content} hidden={isCollapsed}>
        {!hasRepositoryMap && repositoryName !== undefined ? <p className={styles.repositoryName}>{repositoryName}</p> : null}
        {workflows.length === 0 && !hasRepositoryMap ? (
          <p className={styles.empty}>No workflows yet.</p>
        ) : (
          <ul className={styles.list} ref={listRef} onKeyDown={handleKeyDown}>
            {hasRepositoryMap ? (
              <li className={styles.rootItem}>
                <button
                  type="button"
                  data-navigation-item
                  className={`${styles.root} ${overviewSelected ? styles.selectedRoot : ""}`}
                  aria-label={`${repositoryName ?? "Repository"} overview`}
                  aria-current={overviewSelected ? "page" : undefined}
                  onClick={() => onSelect(null)}
                >
                  <Folder size={16} weight="fill" aria-hidden="true" />
                  <span className={styles.rootCopy}>
                    <strong>{repositoryName ?? "Repository"}</strong>
                    <small className={styles.overviewHint}>
                      <CirclesFour size={12} aria-hidden="true" />
                      Overview · repo-wide map
                    </small>
                  </span>
                </button>
                <ul className={styles.branch} aria-label={`${repositoryName ?? "Repository"} workflows`}>
                  {definitions.map((definition) => {
                    const record = workflows.find((workflow) => workflow.id === definition.id);
                    return record === undefined ? (
                      <li key={definition.id} className={styles.plannedItem}>
                        <span className={styles.dot} aria-hidden="true" />
                        <span>
                          <strong>{definition.name}</strong>
                          <small>Not mapped</small>
                        </span>
                      </li>
                    ) : (
                      <WorkflowListItem
                        key={record.id}
                        record={record}
                        selected={record.id === selectedWorkflowId}
                        onSelect={() => onSelect(record.id)}
                      />
                    );
                  })}
                </ul>
              </li>
            ) : (
              definitions.map((definition) => {
                const record = workflows.find((workflow) => workflow.id === definition.id);
                return record === undefined ? null : (
                  <WorkflowListItem
                    key={record.id}
                    record={record}
                    selected={record.id === selectedWorkflowId}
                    onSelect={() => onSelect(record.id)}
                  />
                );
              })
            )}
          </ul>
        )}
        {hasRepositoryMap ? (
          <div className={styles.mapAnother}>
            <GitBranch size={14} aria-hidden="true" />
            <CopyButton value={ANOTHER_WORKFLOW_PROMPT} label="Map another workflow" variant="ghost" />
          </div>
        ) : null}
      </div>
    </nav>
  );
}
