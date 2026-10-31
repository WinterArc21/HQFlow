import { Folder, GitBranch } from "@phosphor-icons/react";
import { useRef, type KeyboardEvent } from "react";
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
}

/**
 * A plain, fully-tabbable button list (Tab/Shift+Tab + Enter/Space work natively) with an
 * Up/Down arrow-key convenience layered on top via DOM focus movement — deliberately not an
 * ARIA `listbox`, since a partial listbox implementation is worse than a correct plain list
 * (contract §11).
 *
 * When a repository map exists, the list is a file tree: the repository folder is Overview,
 * and each workflow hangs off the same spine.
 */
export function WorkflowNavigator({
  workflows,
  repositoryName,
  repositoryMap,
  selectedWorkflowId,
  onSelect,
}: WorkflowNavigatorProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const hasRepositoryMap = repositoryMap !== undefined && repositoryMap !== null;
  const overviewSelected = hasRepositoryMap && selectedWorkflowId === null;
  const definitions = hasRepositoryMap
    ? repositoryMap.repositoryMap.workflows
    : workflows.map((record) => ({
        id: record.id,
        name: record.workflow.name,
        purpose: record.workflow.purpose,
      }));

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
    <nav className={styles.navigator} aria-label="Repository navigation">
      <div className={styles.header}>
        <SectionLabel as="h2">Workflows</SectionLabel>
        <span className={styles.count}>{definitions.length}</span>
      </div>
      <div className={styles.content}>
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
                  <strong className={styles.rootName}>{repositoryName ?? "Repository"}</strong>
                  <small className={styles.overviewHint}>Overview</small>
                </button>
                <ul className={styles.branch} aria-label={`${repositoryName ?? "Repository"} workflows`}>
                  {definitions.map((definition) => {
                    const record = workflows.find((workflow) => workflow.id === definition.id);
                    return record === undefined ? (
                      <li key={definition.id} className={styles.plannedItem}>
                        <span className={styles.plannedName}>{definition.name}</span>
                        <small>Not mapped</small>
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
