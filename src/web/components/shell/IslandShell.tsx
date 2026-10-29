import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { CaretDown, ClipboardText, MagnifyingGlass, Palette } from "@phosphor-icons/react";
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
  /** Where the canvas is: the open workflow's name, or "Overview". */
  locationLabel: string;
  status: CodeHQStatus;
  errorCount?: number;
  /** Changes on every snapshot, so the status dot can ping. */
  pulseKey?: string;
  /** The workflow navigator, shown in the open title card; `close` folds the card back to a pill. */
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
/** Dots the open title card's header and details take above the workflow list, plus one dot of air over the dock. */
const TREE_CLEARANCE = 8;
/** Below this many dot columns the title and status islands can't share the top row. */
const NARROW_COLUMNS = 24;
/** In the narrow layout the title island starts under the two-dot status island. */
const NARROW_IDENTITY_TOP = 3;
/** How long the dock waits after the canvas stops before it comes back. */
const DOCK_RETURN_MS = 350;

/**
 * The app frame: the canvas fills the window and every piece of chrome floats over it as an
 * island on the canvas's own dot grid. Top left is the title: a pill naming the repository and
 * the open workflow that a click grows into a card with the workflow's details and the workflow
 * list. Top right carries status, the agent prompt and theme; the one-row bottom dock carries
 * search and the canvas controls.
 */
export function IslandShell({ repositoryName, locationLabel, status, errorCount, pulseKey, navigator, notice, overlays, children }: IslandShellProps) {
  const grid = useDotGrid();
  const openSearch = useCodeHQStore((state) => state.openSearch);
  const appearanceOpen = useCodeHQStore((state) => state.appearanceOpen);
  const setAppearanceOpen = useCodeHQStore((state) => state.setAppearanceOpen);
  const closeAppearance = useCallback(() => setAppearanceOpen(false), [setAppearanceOpen]);
  const [titleTarget, setTitleTarget] = useState<HTMLElement | null>(null);
  const [controlsTarget, setControlsTarget] = useState<HTMLElement | null>(null);
  const [titleOpen, setTitleOpen] = useState(false);
  const closeTitle = useCallback(() => setTitleOpen(false), []);
  const identityRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

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

  // The open card folds back on a click outside it or on Escape, which also returns focus to the pill.
  useEffect(() => {
    if (!titleOpen) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!identityRef.current?.contains(event.target as Node)) {
        setTitleOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setTitleOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [titleOpen]);

  const chrome = useMemo<CanvasChrome>(() => ({
    titleTarget,
    controlsTarget,
    dockClearance,
    onCanvasMove,
    fitInsets: {
      top: DOT_ORIGIN + (identityTop + 3) * DOT_STEP,
      right: DOT_ORIGIN,
      bottom: DOT_ORIGIN + (dockHeight + 1) * DOT_STEP,
      left: DOT_ORIGIN,
    },
  }), [controlsTarget, dockClearance, dockHeight, identityTop, onCanvasMove, titleTarget]);

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
          data-open={titleOpen ? "true" : undefined}
          style={{ "--identity-max-width": `${identityWidth * DOT_STEP - 2}px` } as CSSProperties}
        >
          {/* One button covers the whole header row; the title itself is portalled in from the canvas. */}
          <button
            ref={triggerRef}
            type="button"
            className={styles.trigger}
            aria-label={`Workflows: ${locationLabel}`}
            aria-expanded={titleOpen}
            aria-controls={titleOpen ? panelId : undefined}
            onClick={() => setTitleOpen((open) => !open)}
          />
          <span className={styles.mark} aria-hidden="true">HQ</span>
          <span className={styles.repositoryName}>{repositoryName}</span>
          <span className={styles.slash} aria-hidden="true">/</span>
          <div ref={setTitleTarget} className={styles.title} />
          <span className={styles.caret} aria-hidden="true"><CaretDown size={14} /></span>
          <span className={styles.rule} aria-hidden="true" />
        </div>
        {titleOpen ? (
          <div id={panelId} className={styles.tree} style={{ maxHeight: treeMaxHeight }}>
            {navigator(closeTitle)}
          </div>
        ) : null}
        <div className={styles.notice}>{notice}</div>
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
