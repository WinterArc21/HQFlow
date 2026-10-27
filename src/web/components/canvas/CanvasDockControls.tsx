import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowCounterClockwise, Check, DotsThreeVertical, DownloadSimple, Minus, PencilSimpleLine, Plus, Trash } from "@phosphor-icons/react";
import { useStore } from "@xyflow/react";
import { IconButton, Tooltip } from "../primitives";
import type { CanvasToolbarProps } from "./CanvasToolbar";
import { CanvasViewSwitch } from "./CanvasViewSwitch";
import type { CanvasView } from "./layout";
import styles from "./CanvasDockControls.module.css";

const VIEW_NAMES: Array<[CanvasView, string]> = [["flow", "Flow"], ["wrap", "Wrap"], ["line", "Line"]];

/**
 * The canvas's own controls as they sit inside the island shell's dock: a zoom group with a live
 * level readout that fits the map when clicked, then the layout actions. Rare and destructive
 * actions live in the "More actions" menu. On a phone only the level and the menu stay in the
 * dock; the menu then also carries the views, reset and export. Same handlers and accessible
 * names as `CanvasToolbar`, which remains the title-strip version for the export viewer and
 * landing demo.
 */
export function CanvasDockControls({ onZoomIn, onZoomOut, onFit, onResetLayout, onReplay, onExport, onDelete, viewSwitch }: CanvasToolbarProps) {
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
      {onExport !== undefined ? (
        <span className={styles.wide}>
          <Tooltip content="Export">
            <IconButton label="Export canvas" icon={<DownloadSimple size={16} />} size="sm" onClick={onExport} />
          </Tooltip>
        </span>
      ) : null}
      <MoreActions narrowOnly={onReplay === undefined && onDelete === undefined}>
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
        {onExport !== undefined ? (
          <MenuItem narrowOnly icon={<DownloadSimple size={14} />} onSelect={onExport}>Export…</MenuItem>
        ) : null}
        {onReplay !== undefined ? (
          <MenuItem icon={<PencilSimpleLine size={14} />} onSelect={onReplay}>Replay the build</MenuItem>
        ) : null}
        {onDelete !== undefined ? (
          <MenuItem danger icon={<Trash size={14} />} onSelect={onDelete}>Delete workflow…</MenuItem>
        ) : null}
      </MoreActions>
    </div>
  );
}

/** A small menu that opens upward from the dock. Escape, an outside click, or a choice closes it. */
function MoreActions({ narrowOnly, children }: { narrowOnly: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    visibleItems(menuRef.current)[0]?.focus();
    const onPointerDown = (event: PointerEvent) => {
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
      setOpen(false);
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
        onClick={() => setOpen((value) => !value)}
      />
      {open ? (
        <div
          ref={menuRef}
          className={styles.menu}
          role="menu"
          aria-label="More actions"
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("[role^='menuitem']") !== null) {
              setOpen(false);
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
