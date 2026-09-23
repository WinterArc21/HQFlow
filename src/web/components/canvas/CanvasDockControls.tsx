import { ArrowCounterClockwise, ArrowsInLineVertical, DownloadSimple, Minus, Plus, Trash } from "@phosphor-icons/react";
import { useStore } from "@xyflow/react";
import { IconButton, Tooltip } from "../primitives";
import type { CanvasToolbarProps } from "./CanvasToolbar";
import styles from "./CanvasDockControls.module.css";

/**
 * The canvas's own controls as they sit inside the island shell's dock: a zoom group with a live
 * level readout, then the layout actions. Same handlers and accessible names as `CanvasToolbar`,
 * which remains the title-strip version for the export viewer and landing demo.
 */
export function CanvasDockControls({ onZoomIn, onZoomOut, onResetLayout, onCollapseAll, collapseDisabled, onExport, onDelete }: CanvasToolbarProps) {
  const zoom = useStore((state) => state.transform[2]);
  return (
    <div className={styles.controls}>
      <div className={styles.zoomGroup}>
        <Tooltip content="Zoom out">
          <IconButton label="Zoom out" icon={<Minus size={14} weight="bold" />} size="sm" onClick={onZoomOut} />
        </Tooltip>
        <span className={styles.level} aria-label="Zoom level">{Math.round(zoom * 100)}%</span>
        <Tooltip content="Zoom in">
          <IconButton label="Zoom in" icon={<Plus size={14} weight="bold" />} size="sm" onClick={onZoomIn} />
        </Tooltip>
      </div>
      <span className={styles.divider} aria-hidden="true" />
      <Tooltip content="Reset layout">
        <IconButton label="Reset layout" icon={<ArrowCounterClockwise size={16} />} size="sm" onClick={onResetLayout} />
      </Tooltip>
      <Tooltip content="Collapse all">
        <IconButton label="Collapse all expanded steps" icon={<ArrowsInLineVertical size={16} />} size="sm" onClick={onCollapseAll} disabled={collapseDisabled} />
      </Tooltip>
      {onExport !== undefined ? (
        <Tooltip content="Export">
          <IconButton label="Export canvas" icon={<DownloadSimple size={16} />} size="sm" onClick={onExport} />
        </Tooltip>
      ) : null}
      {onDelete !== undefined ? (
        <Tooltip content="Delete workflow">
          <IconButton label="Delete workflow" icon={<Trash size={16} />} size="sm" onClick={onDelete} />
        </Tooltip>
      ) : null}
    </div>
  );
}
