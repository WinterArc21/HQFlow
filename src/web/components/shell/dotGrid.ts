import { useSyncExternalStore } from "react";

/**
 * The canvas's dot field is the layout grid for the whole app: the stage paints one dot at the
 * centre of every 28px tile (`WorkflowCanvas.module.css`), and the stage fills the window, so
 * dots sit at `14 + 28k` on both axes. Every island is placed and sized in whole dot steps, so
 * its edges run exactly through dot centres at any window size.
 */
export const DOT_STEP = 28;
export const DOT_ORIGIN = DOT_STEP / 2;

/**
 * An island's box, in dots. `l`/`r`/`t`/`b` are margins from the first/last dot on that axis;
 * `w`/`h` are spans (or `"auto"`, rounded up from the content). `cx`/`cy` centre on the grid.
 * A span may be omitted when both margins on that axis are given.
 */
export interface GridPlacement {
  l?: number;
  r?: number;
  t?: number;
  b?: number;
  w?: number | "auto";
  h?: number | "auto";
  cx?: boolean;
  cy?: boolean;
}

export interface DotGrid {
  width: number;
  height: number;
  /** Index of the last whole dot column / row that fits the window. */
  lastColumn: number;
  lastRow: number;
}

export interface PixelBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

function readGrid(): DotGrid {
  const width = window.innerWidth;
  const height = window.innerHeight;
  return {
    width,
    height,
    lastColumn: Math.floor((width - DOT_ORIGIN) / DOT_STEP),
    lastRow: Math.floor((height - DOT_ORIGIN) / DOT_STEP),
  };
}

let cached: DotGrid | null = null;
function snapshot(): DotGrid {
  const next = readGrid();
  if (cached === null || cached.width !== next.width || cached.height !== next.height) {
    cached = next;
  }
  return cached;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

export function useDotGrid(): DotGrid {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Rounds a measured pixel length up to whole dot steps (never fewer than one). */
export function toDots(px: number): number {
  return Math.max(1, Math.ceil((px - 0.5) / DOT_STEP));
}

/** Resolves a placement to pixels. `measured` supplies the spans for `"auto"` axes, in dots. */
export function resolvePlacement(placement: GridPlacement, grid: DotGrid, measured: { w: number; h: number }): PixelBox {
  const { lastColumn, lastRow } = grid;
  const span = (value: number | "auto" | undefined, auto: number, start = 0, end = 0, last: number) =>
    typeof value === "number" ? value : value === "auto" ? auto : last - start - end;
  const w = Math.max(1, Math.min(span(placement.w, measured.w, placement.l, placement.r, lastColumn), lastColumn));
  const h = Math.max(1, Math.min(span(placement.h, measured.h, placement.t, placement.b, lastRow), lastRow));
  const x = placement.cx
    ? Math.max(0, Math.floor((lastColumn - w) / 2))
    : placement.l !== undefined ? placement.l : lastColumn - (placement.r ?? 0) - w;
  const y = placement.cy
    ? Math.max(0, Math.floor((lastRow - h) / 2))
    : placement.t !== undefined ? placement.t : lastRow - (placement.b ?? 0) - h;
  return { left: DOT_ORIGIN + x * DOT_STEP, top: DOT_ORIGIN + y * DOT_STEP, width: w * DOT_STEP, height: h * DOT_STEP };
}
