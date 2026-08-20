import { CaretDown, CaretRight, FolderSimple } from "@phosphor-icons/react";
import type { DragEvent, FormEvent } from "react";
import { useState } from "react";
import type { WorkflowRecord } from "../../api/types";
import type { Folder } from "../../api/client";
import { ActionsMenu } from "./ActionsMenu";
import { WorkflowListItem } from "./WorkflowListItem";
import styles from "./FolderRow.module.css";

export interface FolderRowProps {
  folder: Folder;
  folders: Folder[];
  workflows: WorkflowRecord[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
  selectedWorkflowId: string | null;
  onSelect: (workflowId: string) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onMoveWorkflow: (workflowId: string, folderId: string | null) => void;
  onReorder: (workflowIds: string[]) => void;
}

const DRAG_DATA_TYPE = "text/codehq-workflow-id";

export function FolderRow({
  folder,
  folders,
  workflows,
  collapsed,
  onToggleCollapsed,
  selectedWorkflowId,
  onSelect,
  onRename,
  onDelete,
  onMoveWorkflow,
  onReorder,
}: FolderRowProps) {
  const [dropActive, setDropActive] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(folder.name);

  const startRename = (): void => {
    setDraftName(folder.name);
    setRenaming(true);
  };

  const submitRename = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const trimmed = draftName.trim();
    if (trimmed.length > 0) {
      onRename(trimmed);
    }
    setRenaming(false);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>): void => {
    if (event.dataTransfer.types.includes(DRAG_DATA_TYPE)) {
      event.preventDefault();
      setDropActive(true);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    setDropActive(false);
    const workflowId = event.dataTransfer.getData(DRAG_DATA_TYPE);
    if (workflowId.length > 0) {
      onMoveWorkflow(workflowId, folder.id);
    }
  };

  /** Dropping directly on a row: reorders if the dragged workflow is already a member of this
   * folder, otherwise falls back to the same "append to this folder" as dropping on the header. */
  const handleItemDrop = (targetIndex: number) => (event: DragEvent<HTMLLIElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    setDropActive(false);
    const workflowId = event.dataTransfer.getData(DRAG_DATA_TYPE);
    if (workflowId.length === 0) {
      return;
    }
    const currentIndex = workflows.findIndex((record) => record.id === workflowId);
    if (currentIndex === -1) {
      onMoveWorkflow(workflowId, folder.id);
      return;
    }
    const reordered = workflows.map((record) => record.id).filter((id) => id !== workflowId);
    const insertAt = currentIndex < targetIndex ? targetIndex - 1 : targetIndex;
    reordered.splice(insertAt, 0, workflowId);
    onReorder(reordered);
  };

  const moveWorkflow = (index: number, direction: -1 | 1): void => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= workflows.length) {
      return;
    }
    const reordered = workflows.map((record) => record.id);
    const [moved] = reordered.splice(index, 1);
    if (moved !== undefined) {
      reordered.splice(targetIndex, 0, moved);
    }
    onReorder(reordered);
  };

  return (
    <li className={styles.folder}>
      <div
        className={`${styles.folderRow} ${dropActive ? styles.dropActive : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={() => setDropActive(false)}
        onDrop={handleDrop}
      >
        {renaming ? (
          <form className={styles.renameForm} onSubmit={submitRename}>
            <label className={styles.renameLabel} htmlFor={`rename-folder-${folder.id}`}>
              Rename {folder.name}
            </label>
            <input
              id={`rename-folder-${folder.id}`}
              className={styles.renameInput}
              type="text"
              autoFocus
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setRenaming(false);
                }
              }}
              onBlur={() => setRenaming(false)}
            />
          </form>
        ) : (
          <button type="button" className={styles.disclosure} aria-expanded={!collapsed} onClick={onToggleCollapsed}>
            {collapsed ? <CaretRight size={14} weight="bold" aria-hidden="true" /> : <CaretDown size={14} weight="bold" aria-hidden="true" />}
            <FolderSimple size={16} weight="fill" aria-hidden="true" className={styles.icon} />
            <span className={styles.name}>{folder.name}</span>
          </button>
        )}
        <ActionsMenu
          label={`Actions for ${folder.name}`}
          items={[
            { label: "Rename", onSelect: startRename },
            { label: "Delete", onSelect: onDelete },
          ]}
        />
      </div>
      {collapsed ? null : (
        <ul className={styles.items} role="group" aria-label={folder.name}>
          {workflows.map((record, index) => (
            <li key={record.id} onDragOver={(event) => event.preventDefault()} onDrop={handleItemDrop(index)}>
              <WorkflowListItem
                record={record}
                selected={record.id === selectedWorkflowId}
                onSelect={() => onSelect(record.id)}
                folders={folders}
                currentFolderId={folder.id}
                onMoveToFolder={(folderId) => onMoveWorkflow(record.id, folderId)}
                {...(index > 0 ? { onMoveUp: () => moveWorkflow(index, -1) } : {})}
                {...(index < workflows.length - 1 ? { onMoveDown: () => moveWorkflow(index, 1) } : {})}
              />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
