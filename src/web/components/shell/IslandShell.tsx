import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { CaretUp, MagnifyingGlass, TreeStructure } from "@phosphor-icons/react";
import type { CanvasChrome } from "../canvas";
import { AGENT_PROMPT } from "../../lib/agentPrompt";
import { searchShortcutLabel } from "../../lib/platform";
import { useCodeHQStore } from "../../store/useCodeHQStore";
import { CopyButton, Kbd } from "../primitives";
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
  /** The workflow navigator; `close` dismisses the tree island. */
  navigator: (close: () => void) => ReactNode;
  /** Shown under the title, e.g. the diagnostics banner. */
  notice?: ReactNode;
  /** Drawers and dialogs, rendered inside the shell so they can snap to the same grid. */
  overlays?: ReactNode;
  children: (chrome: CanvasChrome) => ReactNode;
}

const DOCK_WIDTH = 26;
const DOCK_HEIGHT = 4;
const TREE_WIDTH = 12;
const DRAWER_WIDTH = 15;

/**
 * The app frame: the canvas fills the window and every piece of chrome floats over it as an
 * island on the canvas's own dot grid. Top left names the repository and the open workflow; top
 * right carries status, the agent prompt and theme; the bottom dock carries search, the
 * workflow tree (which rises above the dock) and the canvas controls.
 */
export function IslandShell({ repositoryName, onSelectRepository, locationLabel, status, errorCount, navigator, notice, overlays, children }: IslandShellProps) {
  const grid = useDotGrid();
  const openSearch = useCodeHQStore((state) => state.openSearch);
  const [titleTarget, setTitleTarget] = useState<HTMLElement | null>(null);
  const [controlsTarget, setControlsTarget] = useState<HTMLElement | null>(null);
  const [treeOpen, setTreeOpen] = useState(false);
  const treeRef = useRef<HTMLDivElement>(null);
  const treeToggleRef = useRef<HTMLButtonElement>(null);
  const treeId = useId();

  const { lastColumn, lastRow } = grid;
  const identityWidth = Math.min(16, Math.max(8, lastColumn - 12));
  const dockWidth = Math.min(DOCK_WIDTH, lastColumn);
  const dockLeft = Math.max(0, Math.floor((lastColumn - dockWidth) / 2));
  const drawerMeetsDock = dockLeft + dockWidth > lastColumn - DRAWER_WIDTH;

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

  const chrome = useMemo<CanvasChrome>(() => ({
    titleTarget,
    controlsTarget,
    legendPlacement: { l: 0, b: 0 },
    fitInsets: {
      top: DOT_ORIGIN + 4 * DOT_STEP,
      right: DOT_ORIGIN,
      bottom: DOT_ORIGIN + (DOCK_HEIGHT + 1) * DOT_STEP,
      left: DOT_ORIGIN,
    },
  }), [controlsTarget, titleTarget]);

  // The step drawer is one more island: inset to the grid, below the status island, and above
  // the dock only when the two would otherwise overlap.
  const drawerInsets = {
    "--island-drawer-top": `${DOT_ORIGIN + 3 * DOT_STEP}px`,
    "--island-drawer-right": `${grid.width - (DOT_ORIGIN + lastColumn * DOT_STEP)}px`,
    "--island-drawer-bottom": `${grid.height - (DOT_ORIGIN + (lastRow - (drawerMeetsDock ? DOCK_HEIGHT + 1 : 0)) * DOT_STEP)}px`,
  } as CSSProperties;

  return (
    <div className={styles.shell} style={drawerInsets}>
      <div className={styles.canvas}>{children(chrome)}</div>

      <Island placement={{ l: 0, t: 0, w: identityWidth, h: "auto" }} role="banner">
        <div className={styles.identity}>
          <div className={styles.repository}>
            <span className={styles.mark} aria-hidden="true">HQ</span>
            {onSelectRepository !== undefined ? (
              <button type="button" className={styles.repositoryButton} onClick={onSelectRepository}>{repositoryName}</button>
            ) : (
              <span className={styles.repositoryName}>{repositoryName}</span>
            )}
          </div>
          <div ref={setTitleTarget} />
        </div>
        {notice}
      </Island>

      <Island placement={{ r: 0, t: 0, w: "auto", h: 2 }}>
        <div className={styles.status}>
          <StatusIndicator status={status} {...(errorCount !== undefined ? { errorCount } : {})} />
          <span className={styles.divider} aria-hidden="true" />
          <CopyButton value={AGENT_PROMPT} label="Copy agent prompt" />
          <ThemeToggle />
        </div>
      </Island>

      {treeOpen ? (
        <Island
          ref={treeRef}
          id={treeId}
          placement={{ l: dockLeft, b: DOCK_HEIGHT + 1, w: Math.min(TREE_WIDTH, lastColumn), h: "auto" }}
          maxHeight={Math.max(4, lastRow - DOCK_HEIGHT - 5)}
          className={styles.tree}
        >
          {navigator(() => setTreeOpen(false))}
        </Island>
      ) : null}

      <Island placement={{ l: dockLeft, b: 0, w: dockWidth, h: DOCK_HEIGHT }} className={styles.dock} role="region" aria-label="Search and canvas controls">
        <div className={styles.dockBody}>
          <button type="button" className={styles.search} onClick={openSearch}>
            <MagnifyingGlass size={16} aria-hidden="true" />
            <span className={styles.searchLabel}>Search steps, files and workflows…</span>
            <Kbd>{searchShortcutLabel()}</Kbd>
          </button>
          <div className={styles.dockRow}>
            <button
              ref={treeToggleRef}
              type="button"
              className={styles.location}
              aria-label={`Workflows: ${locationLabel}`}
              aria-expanded={treeOpen}
              aria-controls={treeOpen ? treeId : undefined}
              data-open={treeOpen ? "true" : undefined}
              onClick={() => setTreeOpen((open) => !open)}
            >
              <TreeStructure size={14} aria-hidden="true" />
              <span className={styles.locationRepo}>{repositoryName}</span>
              <span className={styles.locationRepo} aria-hidden="true">/</span>
              <span className={styles.locationName}>{locationLabel}</span>
              <CaretUp size={12} className={styles.caret} aria-hidden="true" />
            </button>
            <div ref={setControlsTarget} className={styles.controls} />
          </div>
        </div>
      </Island>

      {overlays}
    </div>
  );
}
