import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { CaretDown, ClipboardText, MagnifyingGlass, Palette, TreeStructure } from "@phosphor-icons/react";
import type { CanvasChrome } from "../canvas";
import { AGENT_PROMPT } from "../../lib/agentPrompt";
import { searchShortcutLabel } from "../../lib/platform";
import { useCodeHQStore } from "../../store/useCodeHQStore";
import { AppearancePanel } from "../appearance";
import { CopyButton, IconButton, Tooltip } from "../primitives";
import { DOT_ORIGIN, DOT_STEP, useDotGrid } from "./dotGrid";
import { Island } from "./Island";
import { StatusIndicator, type CodeHQStatus } from "./StatusIndicator";
import { ThemeToggle } from "./ThemeToggle";
import styles from "./IslandShell.module.css";

export interface IslandShellProps {
  repositoryName: string;
  /** Present when the repository has an overview to return to. */
  onSelectRepository?: () => void;
  /** Where the canvas is: the open workflow's name, or "Overview". */
  locationLabel: string;
  status: CodeHQStatus;
  errorCount?: number;
  /** Changes on every snapshot, so the status dot can ping. */
  pulseKey?: string;
  /** The workflow navigator; `close` dismisses the tree island. */
  navigator: (close: () => void) => ReactNode;
  /** Shown under the title, e.g. the diagnostics banner. */
  notice?: ReactNode;
  /** Drawers and dialogs, rendered inside the shell so they can snap to the same grid. */
  overlays?: ReactNode;
  children: (chrome: CanvasChrome) => ReactNode;
}

/** The dock is one row, the search icon then the canvas controls, about this many dots wide. */
const DOCK_WIDTH = 14;
const DOCK_HEIGHT = 2;
const DRAWER_WIDTH = 15;
/** Dots the open title card takes above the workflow tree, plus one dot of air over the dock. */
const TREE_CLEARANCE = 8;
/** Below this many dot columns the title and status islands can't share the top row. */
const NARROW_COLUMNS = 24;
/** In the narrow layout the title island starts under the two-dot status island. */
const NARROW_IDENTITY_TOP = 3;
/** Below this window width the title stays a pill until the reader asks for the full card. */
const COMPACT_TITLE_WIDTH = 900;
/** How long the dock waits after the canvas stops before it comes back. */
const DOCK_RETURN_MS = 350;

/**
 * The app frame: the canvas fills the window and every piece of chrome floats over it as an
 * island on the canvas's own dot grid. Top left names the repository and the open workflow, and
 * holds the workflow tree, which opens by growing the title card downward; top right carries
 * status, the agent prompt and theme; the one-row bottom dock carries search and the canvas
 * controls.
 */
export function IslandShell({ repositoryName, onSelectRepository, locationLabel, status, errorCount, pulseKey, navigator, notice, overlays, children }: IslandShellProps) {
  const grid = useDotGrid();
  const openSearch = useCodeHQStore((state) => state.openSearch);
  const appearanceOpen = useCodeHQStore((state) => state.appearanceOpen);
  const setAppearanceOpen = useCodeHQStore((state) => state.setAppearanceOpen);
  const closeAppearance = useCallback(() => setAppearanceOpen(false), [setAppearanceOpen]);
  const [titleTarget, setTitleTarget] = useState<HTMLElement | null>(null);
  const [controlsTarget, setControlsTarget] = useState<HTMLElement | null>(null);
  const [treeOpen, setTreeOpen] = useState(false);
  const treeRef = useRef<HTMLDivElement>(null);
  const treeToggleRef = useRef<HTMLButtonElement>(null);
  const treeId = useId();

  // On a wide window the title card always shows in full, description included. On a narrow one it
  // is a pill that hover, focus or a tap opens. The open workflow tree keeps it open.
  const identityRef = useRef<HTMLDivElement>(null);
  const [titleHover, setTitleHover] = useState(false);
  const [titleFocus, setTitleFocus] = useState(false);
  const [titleTapped, setTitleTapped] = useState(false);
  const compactTitle = grid.width < COMPACT_TITLE_WIDTH;
  const titleOpen = treeOpen || titleHover || titleFocus || titleTapped || !compactTitle;
  const titleOpenRef = useRef(titleOpen);
  useEffect(() => {
    titleOpenRef.current = titleOpen;
  }, [titleOpen]);

  // Native listeners, not React props: the workflow title is portalled in from the canvas, and
  // React routes a portal's events through the canvas's tree, not through this island.
  useEffect(() => {
    const island = identityRef.current;
    if (island === null) {
      return;
    }
    let pointerType = "mouse";
    const onPointerDown = (event: PointerEvent) => { pointerType = event.pointerType; };
    const onPointerEnter = (event: PointerEvent) => { if (event.pointerType === "mouse") setTitleHover(true); };
    const onPointerLeave = () => setTitleHover(false);
    const onFocusIn = () => setTitleFocus(true);
    const onFocusOut = (event: FocusEvent) => {
      if (!island.contains(event.relatedTarget as Node | null)) {
        setTitleFocus(false);
      }
    };
    // On a touch screen the first tap opens the pill; it does not also leave the workflow.
    const onClick = (event: MouseEvent) => {
      if (!titleOpenRef.current && pointerType !== "mouse") {
        event.preventDefault();
        event.stopPropagation();
        setTitleTapped(true);
      }
    };
    island.addEventListener("pointerdown", onPointerDown, true);
    island.addEventListener("pointerenter", onPointerEnter);
    island.addEventListener("pointerleave", onPointerLeave);
    island.addEventListener("focusin", onFocusIn);
    island.addEventListener("focusout", onFocusOut);
    island.addEventListener("click", onClick, true);
    return () => {
      island.removeEventListener("pointerdown", onPointerDown, true);
      island.removeEventListener("pointerenter", onPointerEnter);
      island.removeEventListener("pointerleave", onPointerLeave);
      island.removeEventListener("focusin", onFocusIn);
      island.removeEventListener("focusout", onFocusOut);
      island.removeEventListener("click", onClick, true);
    };
  }, []);

  // The dock steps back while the reader pans, zooms or drags, and returns once the canvas rests.
  const [canvasActive, setCanvasActive] = useState(false);
  const [canvasMoving, setCanvasMoving] = useState(false);
  const onCanvasMove = useCallback((moving: boolean) => {
    setCanvasActive(moving);
    if (moving) {
      setCanvasMoving(true);
    }
  }, []);
  useEffect(() => {
    if (canvasActive || !canvasMoving) {
      return;
    }
    const timer = window.setTimeout(() => setCanvasMoving(false), DOCK_RETURN_MS);
    return () => window.clearTimeout(timer);
  }, [canvasActive, canvasMoving]);

  const { lastColumn, lastRow } = grid;
  const narrow = lastColumn < NARROW_COLUMNS;
  const identityWidth = narrow ? lastColumn : Math.min(16, Math.max(8, lastColumn - 12));
  const identityTop = narrow ? NARROW_IDENTITY_TOP : 0;
  const dockWidth = Math.min(DOCK_WIDTH, lastColumn);
  const dockHeight = DOCK_HEIGHT;
  const dockLeft = Math.max(0, Math.floor((lastColumn - dockWidth) / 2));
  const drawerMeetsDock = dockLeft + dockWidth > lastColumn - DRAWER_WIDTH;
  const treeMaxHeight = Math.max(2, lastRow - identityTop - dockHeight - TREE_CLEARANCE) * DOT_STEP;
  // Pixels from the window's bottom edge up to the dock's top edge.
  const dockClearance = grid.height - (DOT_ORIGIN + (lastRow - dockHeight) * DOT_STEP);

  useEffect(() => {
    if (!treeOpen) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!treeRef.current?.contains(target) && !treeToggleRef.current?.contains(target)) {
        setTreeOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setTreeOpen(false);
        treeToggleRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [treeOpen]);

  useEffect(() => {
    if (!titleTapped) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!identityRef.current?.contains(event.target as Node)) {
        setTitleTapped(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [titleTapped]);

  const chrome = useMemo<CanvasChrome>(() => ({
    titleTarget,
    controlsTarget,
    dockClearance,
    onCanvasMove,
    fitInsets: {
      top: DOT_ORIGIN + (identityTop + (compactTitle ? 3 : 7)) * DOT_STEP,
      right: DOT_ORIGIN,
      bottom: DOT_ORIGIN + (dockHeight + 1) * DOT_STEP,
      left: DOT_ORIGIN,
    },
  }), [compactTitle, controlsTarget, dockClearance, dockHeight, identityTop, onCanvasMove, titleTarget]);

  // The step drawer is one more island: inset to the grid, below the status island, and above
  // the dock only when the two would otherwise overlap.
  const drawerInsets = {
    "--island-drawer-top": `${DOT_ORIGIN + 3 * DOT_STEP}px`,
    "--island-drawer-right": `${grid.width - (DOT_ORIGIN + lastColumn * DOT_STEP)}px`,
    "--island-drawer-bottom": `${grid.height - (DOT_ORIGIN + (lastRow - (drawerMeetsDock ? dockHeight + 1 : 0)) * DOT_STEP)}px`,
  } as CSSProperties;

  return (
    <div className={styles.shell} style={drawerInsets}>
      <div className={styles.canvas}>{children(chrome)}</div>

      <Island
        ref={identityRef}
        placement={{ l: 0, t: identityTop, w: titleOpen ? identityWidth : "auto", h: "auto" }}
        className={styles.identityIsland}
        role="banner"
      >
        <div
          className={styles.identity}
          data-collapsed={titleOpen ? undefined : "true"}
          style={{ "--identity-max-width": `${identityWidth * DOT_STEP - 2}px` } as CSSProperties}
        >
          <div className={styles.repository}>
            <span className={styles.mark} aria-hidden="true">HQ</span>
            {onSelectRepository !== undefined ? (
              <button type="button" className={styles.repositoryButton} onClick={onSelectRepository}>{repositoryName}</button>
            ) : (
              <span className={styles.repositoryName}>{repositoryName}</span>
            )}
            <span className={styles.slash} aria-hidden="true">/</span>
          </div>
          <button
            ref={treeToggleRef}
            type="button"
            className={styles.switcher}
            aria-label={`Workflows: ${locationLabel}`}
            aria-expanded={treeOpen}
            aria-controls={treeOpen ? treeId : undefined}
            data-open={treeOpen ? "true" : undefined}
            onClick={() => setTreeOpen((open) => !open)}
          >
            <TreeStructure size={14} aria-hidden="true" />
            <CaretDown size={12} className={styles.caret} aria-hidden="true" />
          </button>
          <div ref={setTitleTarget} className={styles.title} />
        </div>
        {treeOpen ? (
          <div ref={treeRef} id={treeId} className={styles.tree} style={{ maxHeight: treeMaxHeight }}>
            {navigator(() => setTreeOpen(false))}
          </div>
        ) : null}
        {notice}
      </Island>

      <Island placement={{ r: 0, t: 0, w: "auto", h: 2 }}>
        <div className={styles.status}>
          <StatusIndicator status={status} {...(errorCount !== undefined ? { errorCount } : {})} {...(pulseKey !== undefined ? { pulseKey } : {})} />
          <span className={styles.divider} aria-hidden="true" />
          <CopyButton value={AGENT_PROMPT} label="Copy agent prompt" {...(narrow ? { icon: <ClipboardText size={16} /> } : {})} />
          <span data-appearance-toggle="">
            <IconButton
              label="Appearance"
              icon={<Palette size={16} />}
              aria-expanded={appearanceOpen}
              onClick={() => setAppearanceOpen(!appearanceOpen)}
            />
          </span>
          <ThemeToggle />
        </div>
      </Island>

      <Island
        placement={{ cx: true, b: 0, w: "auto", h: "auto" }}
        className={styles.dock}
        role="region"
        aria-label="Search and canvas controls"
        data-receded={canvasMoving ? "true" : undefined}
      >
        <div className={styles.dockBody}>
          <Tooltip content={`Search (${searchShortcutLabel()})`}>
            <IconButton label="Search" icon={<MagnifyingGlass size={16} />} size="sm" onClick={openSearch} />
          </Tooltip>
          <span className={styles.divider} aria-hidden="true" />
          <div ref={setControlsTarget} className={styles.controls} />
        </div>
      </Island>

      {appearanceOpen ? <AppearancePanel onClose={closeAppearance} /> : null}
      {overlays}
    </div>
  );
}
