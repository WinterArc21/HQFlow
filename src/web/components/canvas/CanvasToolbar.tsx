import {
  ArrowCounterClockwise,
  DownloadSimple,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  Trash,
} from "@phosphor-icons/react";
import { IconButton } from "../primitives";
import { CanvasViewSwitch, type CanvasViewSwitchProps } from "./CanvasViewSwitch";
import styles from "./CanvasToolbar.module.css";

export interface CanvasToolbarProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  /** Fits the whole map back into view; the dock's zoom level calls it when clicked. */
  onFit?: () => void;
  onResetLayout: () => void;
  /** When provided, an export button is shown. Omitted in the export viewer. */
  onExport?: () => void;
  /** Redraws the map as if the agent were writing it; the live app's dock only. */
  onReplay?: () => void;
  /** Only available for a completed workflow in the live app. */
  onDelete?: () => void;
  /** The Flow / Wrap / Line switch. */
  viewSwitch?: CanvasViewSwitchProps;
}

/** The canvas's own chrome: zoom, reset, and (when available) export/delete. */
export function CanvasToolbar({
  onZoomIn,
  onZoomOut,
  onResetLayout,
  onExport,
  onDelete,
  viewSwitch,
}: CanvasToolbarProps) {
  return (
    <div className={styles.toolbar}>
      {viewSwitch !== undefined ? (
        <>
          <CanvasViewSwitch {...viewSwitch} />
          <div className={styles.divider} aria-hidden="true" />
        </>
      ) : null}
      <div className={styles.zoomGroup}>
        <IconButton label="Zoom in" icon={<MagnifyingGlassPlus size={16} />} size="sm" onClick={onZoomIn} />
        <IconButton label="Zoom out" icon={<MagnifyingGlassMinus size={16} />} size="sm" onClick={onZoomOut} />
        <IconButton
          label="Reset layout"
          icon={<ArrowCounterClockwise size={16} />}
          size="sm"
          onClick={onResetLayout}
        />
      </div>
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
