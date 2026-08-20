import { Check } from "@phosphor-icons/react";
import type { DragEvent } from "react";
import type { WorkflowRecord } from "../../api/types";
import type { Folder } from "../../api/client";
import { statusTone } from "../../design/semantics";
import { formatRelativeTime } from "../../lib/relativeTime";
import { Badge } from "../primitives";
import { ActionsMenu, type ActionsMenuItem } from "./ActionsMenu";
import styles from "./WorkflowListItem.module.css";

export interface WorkflowListItemProps {
  record: WorkflowRecord;
  selected: boolean;
  onSelect: () => void;
  /** All folders, for the "Move to folder..." action */
  folders?: Folder[];
  currentFolderId?: string | null;
  onMoveToFolder?: (folderId: string | null) => void;
  /** Present only when this row is inside a folder and isn't first/last — omitted at the ends. */
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

const DRAG_DATA_TYPE = "text/codehq-workflow-id";

/**
 * One row. Selection is signalled three ways at once — a left border, bold text, and a
 * check icon — never by colour alone (contract §11), and via `aria-current` for assistive
 * tech.
 *
 * Draggable onto a `FolderRow` to move it there, with a "Move to folder..." menu action as the
 * keyboard/assistive-tech equivalent .
 */
export function WorkflowListItem({
  record,
  selected,
  onSelect,
  folders,
  currentFolderId,
  onMoveToFolder,
  onMoveUp,
  onMoveDown,
}: WorkflowListItemProps) {
  const status = statusTone(record.workflow.status);

  const moveItems: ActionsMenuItem[] =
    folders !== undefined && onMoveToFolder !== undefined
      ? [
          ...folders
            .filter((folder) => folder.id !== currentFolderId)
            .map((folder) => ({ label: `Move to ${folder.name}`, onSelect: () => onMoveToFolder(folder.id) })),
          ...(currentFolderId != null ? [{ label: "Remove from folder", onSelect: () => onMoveToFolder(null) }] : []),
          ...(onMoveUp !== undefined ? [{ label: "Move up", onSelect: onMoveUp }] : []),
          ...(onMoveDown !== undefined ? [{ label: "Move down", onSelect: onMoveDown }] : []),
        ]
      : [];

  return (
    <div
      className={styles.row}
      draggable={onMoveToFolder !== undefined}
      onDragStart={(event: DragEvent<HTMLDivElement>) => {
        event.dataTransfer.setData(DRAG_DATA_TYPE, record.id);
        event.dataTransfer.effectAllowed = "move";
      }}
    >
      <button
        type="button"
        data-workflow-item
        className={`${styles.item} ${selected ? styles.selected : ""}`}
        aria-current={selected ? "true" : undefined}
        onClick={onSelect}
      >
        <div className={styles.main}>
          <div className={styles.headerRow}>
            <span className={styles.name}>{record.workflow.name}</span>
            {selected ? <Check size={14} weight="bold" className={styles.check} aria-hidden="true" /> : null}
          </div>
          <p className={styles.purpose}>{record.workflow.purpose}</p>
          <div className={styles.meta}>
            <Badge tone={status.tone}>{status.label}</Badge>
            {record.state === "stale" ? <Badge tone="amber">Stale</Badge> : null}
            <span className={styles.stepCount}>{record.workflow.steps.length} steps</span>
            <span className={styles.time}>{formatRelativeTime(record.modifiedAt)}</span>
          </div>
        </div>
      </button>
      {moveItems.length > 0 ? <ActionsMenu label={`Actions for ${record.workflow.name}`} items={moveItems} /> : null}
    </div>
  );
}
