import {
  ArrowCounterClockwise,
  ArrowsInLineVertical,
  DownloadSimple,
  FloppyDisk,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  Trash,
} from "@phosphor-icons/react";
import { IconButton } from "../primitives";
import styles from "./CanvasToolbar.module.css";

export interface CanvasToolbarProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetLayout: () => void;
  /** When provided, a Save Layout button is shown. Omitted in the export viewer */
  onSaveLayout?: () => void;
  saveLayoutPending?: boolean;
  onCollapseAll: () => void;
  collapseDisabled: boolean;
  /** When provided, an export button is shown. Omitted in the export viewer. */
  onExport?: () => void;
  /** Only available for a completed workflow in the live app. */
  onDelete?: () => void;
}

/** The canvas's own chrome: zoom, collapse-all, and (when available) export/delete. */
export function CanvasToolbar({
  onZoomIn,
  onZoomOut,
  onResetLayout,
  onSaveLayout,
  saveLayoutPending,
  onCollapseAll,
  collapseDisabled,
  onExport,
  onDelete,
}: CanvasToolbarProps) {
  return (
    <div className={styles.toolbar}>
      <div className={styles.zoomGroup}>
        <IconButton label="Zoom in" icon={<MagnifyingGlassPlus size={16} />} size="sm" onClick={onZoomIn} />
        <IconButton label="Zoom out" icon={<MagnifyingGlassMinus size={16} />} size="sm" onClick={onZoomOut} />
        <IconButton
          label="Reset layout"
          icon={<ArrowCounterClockwise size={16} />}
          size="sm"
          onClick={onResetLayout}
        />
        {onSaveLayout !== undefined ? (
          <IconButton
            label={saveLayoutPending === true ? "Saving layout…" : "Save layout"}
            icon={<FloppyDisk size={16} />}
            size="sm"
            onClick={onSaveLayout}
            disabled={saveLayoutPending === true}
          />
        ) : null}
      </div>
      <div className={styles.divider} aria-hidden="true" />
      <IconButton
        label="Collapse all expanded steps"
        icon={<ArrowsInLineVertical size={16} />}
        size="sm"
        onClick={onCollapseAll}
        disabled={collapseDisabled}
      />
      {onExport !== undefined ? (
        <>
          <div className={styles.divider} aria-hidden="true" />
          <IconButton label="Export canvas" icon={<DownloadSimple size={16} />} size="sm" onClick={onExport} />
        </>
      ) : null}
      {onDelete !== undefined ? (
        <>
          <div className={styles.divider} aria-hidden="true" />
          <IconButton label="Delete workflow" icon={<Trash size={16} />} size="sm" onClick={onDelete} />
        </>
      ) : null}
    </div>
  );
}
