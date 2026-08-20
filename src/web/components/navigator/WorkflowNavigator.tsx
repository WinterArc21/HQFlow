import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { useId, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import type { WorkflowRecord } from "../../api/types";
import type { FolderState } from "../../api/client";
import { SectionLabel } from "../primitives";
import { FolderRow } from "./FolderRow";
import { NewFolderControl } from "./NewFolderControl";
import { useFolderCollapse } from "./useFolderCollapse";
import { WorkflowListItem } from "./WorkflowListItem";
import styles from "./WorkflowNavigator.module.css";

const EMPTY_FOLDER_STATE: FolderState = { folders: [] };

export interface WorkflowNavigatorProps {
  workflows: WorkflowRecord[];
  selectedWorkflowId: string | null;
  onSelect: (workflowId: string) => void;
  /** Controlled by App for the shell grid; omitted for a self-contained navigator. */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** Local, per-clone folder organization */
  folderState?: FolderState;
  onCreateFolder?: (name: string) => void;
  onRenameFolder?: (folderId: string, name: string) => void;
  onDeleteFolder?: (folderId: string) => void;
  onAssignWorkflowToFolder?: (workflowId: string, folderId: string | null) => void;
  onReorderFolder?: (folderId: string, workflowIds: string[]) => void;
}

/**
 * A plain, fully-tabbable button list (Tab/Shift+Tab + Enter/Space work natively) with an
 * Up/Down arrow-key convenience layered on top via DOM focus movement — deliberately not an
 * ARIA `listbox`, since a partial listbox implementation is worse than a correct plain list
 * (contract §11).
 */
export function WorkflowNavigator({
  workflows,
  selectedWorkflowId,
  onSelect,
  collapsed,
  onToggleCollapsed,
  folderState = EMPTY_FOLDER_STATE,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onAssignWorkflowToFolder,
  onReorderFolder,
}: WorkflowNavigatorProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const [uncontrolledCollapsed, setUncontrolledCollapsed] = useState(false);
  const isCollapsed = collapsed ?? uncontrolledCollapsed;
  const { collapsedIds: collapsedFolderIds, toggle: toggleFolderCollapsed } = useFolderCollapse();

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
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-workflow-item]") ?? []);
    const currentIndex = buttons.findIndex((button) => button === document.activeElement);
    if (currentIndex === -1) {
      return;
    }
    event.preventDefault();
    const nextIndex = event.key === "ArrowDown" ? Math.min(currentIndex + 1, buttons.length - 1) : Math.max(currentIndex - 1, 0);
    buttons[nextIndex]?.focus();
  };

  const handleAssignWorkflowToFolder = (workflowId: string, folderId: string | null): void => {
    onAssignWorkflowToFolder?.(workflowId, folderId);
  };

  const handleUnassignedDrop = (event: DragEvent<HTMLUListElement>): void => {
    const workflowId = event.dataTransfer.getData("text/codehq-workflow-id");
    if (workflowId.length > 0) {
      event.preventDefault();
      handleAssignWorkflowToFolder(workflowId, null);
    }
  };

  const workflowsById = new Map(workflows.map((record) => [record.id, record] as const));
  const assignedIds = new Set(folderState.folders.flatMap((folder) => folder.workflowIds));
  const unassigned = workflows.filter((record) => !assignedIds.has(record.id));
  const hasFolderSupport = onAssignWorkflowToFolder !== undefined;

  return (
    <nav className={`${styles.navigator} ${isCollapsed ? styles.collapsed : ""}`} aria-label="Workflows">
      <div className={styles.header}>
        {isCollapsed ? null : <SectionLabel as="h2">Workflows</SectionLabel>}
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
        {onCreateFolder !== undefined ? <NewFolderControl onCreate={onCreateFolder} /> : null}
        {workflows.length === 0 ? (
          <p className={styles.empty}>No workflows yet.</p>
        ) : (
          <ul
            className={styles.list}
            ref={listRef}
            onKeyDown={handleKeyDown}
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleUnassignedDrop}
          >
            {folderState.folders.map((folder) => (
              <FolderRow
                key={folder.id}
                folder={folder}
                folders={folderState.folders}
                workflows={folder.workflowIds
                  .map((id) => workflowsById.get(id))
                  .filter((record): record is WorkflowRecord => record !== undefined)}
                collapsed={collapsedFolderIds[folder.id] === true}
                onToggleCollapsed={() => toggleFolderCollapsed(folder.id)}
                selectedWorkflowId={selectedWorkflowId}
                onSelect={onSelect}
                onRename={(name) => onRenameFolder?.(folder.id, name)}
                onDelete={() => onDeleteFolder?.(folder.id)}
                onMoveWorkflow={handleAssignWorkflowToFolder}
                onReorder={(workflowIds) => onReorderFolder?.(folder.id, workflowIds)}
              />
            ))}
            {unassigned.map((record) => (
              <li key={record.id}>
                <WorkflowListItem
                  record={record}
                  selected={record.id === selectedWorkflowId}
                  onSelect={() => onSelect(record.id)}
                  {...(hasFolderSupport
                    ? {
                        folders: folderState.folders,
                        currentFolderId: null,
                        onMoveToFolder: (folderId: string | null) => handleAssignWorkflowToFolder(record.id, folderId),
                      }
                    : {})}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </nav>
  );
}
