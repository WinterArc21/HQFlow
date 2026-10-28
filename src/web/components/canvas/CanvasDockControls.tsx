import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowCounterClockwise, Check, DotsThreeVertical, DownloadSimple, Minus, PencilSimpleLine, Plus, Trash } from "@phosphor-icons/react";
import { useStore } from "@xyflow/react";
import { IconButton, Tooltip } from "../primitives";
import { swatchStyle } from "./CanvasLegend";
import type { CanvasToolbarProps } from "./CanvasToolbar";
import { CanvasViewSwitch } from "./CanvasViewSwitch";
import type { CanvasView } from "./layout";
import styles from "./CanvasDockControls.module.css";

const VIEW_NAMES: Array<[CanvasView, string]> = [["flow", "Flow"], ["wrap", "Wrap"], ["line", "Line"]];

/**
 * The canvas's own controls as they sit inside the island shell's dock: a zoom group with a live
 * level readout that fits the map when clicked, then the layout actions. The connection key and
 * the rare and destructive actions live in the "More actions" menu. On a phone only the level and the menu stay in the
 * dock; the menu then also carries the views, reset, replay and export. Same handlers and accessible
 * names as `CanvasToolbar`, which remains the title-strip version for the export viewer and
 * landing demo.
 */
export function CanvasDockControls({ onZoomIn, onZoomOut, onFit, onResetLayout, onReplay, onExport, onDelete, viewSwitch, legend }: CanvasToolbarProps) {
  const legendRows = legend?.rows ?? [];
  const zoom = useStore((state) => state.transform[2]);
  const level = `${Math.round(zoom * 100)}%`;
  return (
    <div className={styles.controls}>
      {viewSwitch !== undefined ? (
        <span className={styles.wide}>
          <CanvasViewSwitch {...viewSwitch} />
          <span className={styles.divider} aria-hidden="true" />
        </span>
      ) : null}
      <div className={styles.zoomGroup}>
        <span className={styles.wide}>
          <Tooltip content="Zoom out">
            <IconButton label="Zoom out" icon={<Minus size={14} weight="bold" />} size="sm" onClick={onZoomOut} />
          </Tooltip>
        </span>
        {onFit !== undefined ? (
          <Tooltip content="Fit to screen">
            <button type="button" className={`${styles.level} ${styles.levelButton}`} aria-label={`Zoom ${level}. Fit to screen`} onClick={onFit}>
              {level}
            </button>
          </Tooltip>
        ) : (
          <span className={styles.level} aria-label="Zoom level">{level}</span>
        )}
        <span className={styles.wide}>
          <Tooltip content="Zoom in">
            <IconButton label="Zoom in" icon={<Plus size={14} weight="bold" />} size="sm" onClick={onZoomIn} />
          </Tooltip>
        </span>
      </div>
      <span className={styles.wide}>
        <span className={styles.divider} aria-hidden="true" />
      </span>
      <span className={styles.wide}>
        <Tooltip content="Reset layout">
          <IconButton label="Reset layout" icon={<ArrowCounterClockwise size={16} />} size="sm" onClick={onResetLayout} />
        </Tooltip>
      </span>
      {onReplay !== undefined ? (
        <span className={styles.wide}>
          <Tooltip content="Replay the build">
            <IconButton label="Replay the build" icon={<PencilSimpleLine size={16} />} size="sm" onClick={onReplay} />
          </Tooltip>
        </span>
      ) : null}
      {onExport !== undefined ? (
        <span className={styles.wide}>
          <Tooltip content="Export">
            <IconButton label="Export canvas" icon={<DownloadSimple size={16} />} size="sm" onClick={onExport} />
          </Tooltip>
        </span>
      ) : null}
      <MoreActions
        narrowOnly={onDelete === undefined && legendRows.length === 0}
        {...(legend !== undefined ? { onClose: () => legend.onHighlight(null) } : {})}
      >
        {legend !== undefined && legendRows.length > 0 ? (
          <div className={styles.key} role="group" aria-label="Connection legend" onPointerLeave={() => legend.onHighlight(null)}>
            <p className={styles.keyHeading} aria-hidden="true">Connections</p>
            {legendRows.map((row) => (
              <div key={row.key} className={styles.keyRow} onPointerEnter={() => legend.onHighlight(row.key)}>
                <span className={styles.swatch} style={swatchStyle(row.visual)} aria-hidden="true" />
                {row.label}
              </div>
            ))}
          </div>
        ) : null}
        {viewSwitch !== undefined ? VIEW_NAMES.map(([view, name]) => (
          <MenuItem
            key={view}
            narrowOnly
            role="menuitemradio"
            checked={viewSwitch.view === view}
            icon={viewSwitch.view === view ? <Check size={14} weight="bold" /> : <span />}
            onSelect={() => viewSwitch.onViewChange(view)}
          >
            {name} view{view === viewSwitch.autoView ? " (suggested)" : ""}
          </MenuItem>
        )) : null}
        <MenuItem narrowOnly icon={<ArrowCounterClockwise size={14} />} onSelect={onResetLayout}>Reset layout</MenuItem>
        {onReplay !== undefined ? (
          <MenuItem narrowOnly icon={<PencilSimpleLine size={14} />} onSelect={onReplay}>Replay the build</MenuItem>
        ) : null}
        {onExport !== undefined ? (
          <MenuItem narrowOnly icon={<DownloadSimple size={14} />} onSelect={onExport}>Export…</MenuItem>
        ) : null}
        {onDelete !== undefined ? (
          <MenuItem danger icon={<Trash size={14} />} onSelect={onDelete}>Delete workflow…</MenuItem>
        ) : null}
      </MoreActions>
    </div>
  );
}

/** A small menu that opens upward from the dock. Escape, an outside click, or a choice closes it. */
function MoreActions({ narrowOnly, onClose, children }: { narrowOnly: boolean; onClose?: () => void; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const close = () => {
    setOpen(false);
    onClose?.();
  };

  useEffect(() => {
    if (!open) {
      return;
    }
    visibleItems(menuRef.current)[0]?.focus();
    const onPointerDown = (event: PointerEvent) => {
      // The pointer has already left the key rows, which cleared any highlight.
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
      rootRef.current?.querySelector<HTMLElement>("button")?.focus();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }
    event.preventDefault();
    const items = visibleItems(menuRef.current);
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <span ref={rootRef} className={`${styles.more} ${narrowOnly ? styles.narrow : ""}`} onKeyDown={onKeyDown}>
      <IconButton
        label="More actions"
        icon={<DotsThreeVertical size={16} weight="bold" />}
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      />
      {open ? (
        <div
          ref={menuRef}
          className={styles.menu}
          role="menu"
          aria-label="More actions"
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("[role^='menuitem']") !== null) {
              close();
              rootRef.current?.querySelector<HTMLElement>("button")?.focus();
            }
          }}
        >
          {children}
        </div>
      ) : null}
    </span>
  );
}

function visibleItems(menu: HTMLElement | null): HTMLElement[] {
  return Array.from(menu?.querySelectorAll<HTMLElement>("[role^='menuitem']") ?? []).filter((item) => item.offsetParent !== null);
}

interface MenuItemProps {
  icon: ReactNode;
  onSelect: () => void;
  /** Only on a phone, where the dock has no room for the button that does the same. */
  narrowOnly?: boolean;
  danger?: boolean;
  role?: "menuitem" | "menuitemradio";
  checked?: boolean;
  children: ReactNode;
}

function MenuItem({ icon, onSelect, narrowOnly = false, danger = false, role = "menuitem", checked, children }: MenuItemProps) {
  return (
    <button
      type="button"
      role={role}
      tabIndex={-1}
      className={`${styles.item} ${narrowOnly ? styles.narrow : ""} ${danger ? styles.danger : ""}`}
      {...(role === "menuitemradio" ? { "aria-checked": checked === true } : {})}
      onClick={onSelect}
    >
      <span className={styles.itemIcon} aria-hidden="true">{icon}</span>
      {children}
    </button>
  );
}
