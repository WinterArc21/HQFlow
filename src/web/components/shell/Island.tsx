import { forwardRef, useLayoutEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode, type RefObject } from "react";
import { DOT_STEP, resolvePlacement, toDots, useDotGrid, type GridPlacement, type PixelBox } from "./dotGrid";
import styles from "./Island.module.css";

/**
 * Places an element on the dot grid. `"auto"` spans are measured from `contentRef` and rounded up
 * to whole dots, so a box grows a full step at a time and its edges stay on dot centres.
 */
export function useGridBox(contentRef: RefObject<HTMLElement | null>, placement: GridPlacement | undefined): PixelBox | null {
  const grid = useDotGrid();
  const [measured, setMeasured] = useState({ w: 1, h: 1 });
  const measuresSomething = placement !== undefined && (placement.w === "auto" || placement.h === "auto");
  useLayoutEffect(() => {
    const element = contentRef.current;
    if (!measuresSomething || element === null) {
      return;
    }
    const measure = () => {
      const w = toDots(element.offsetWidth + 1);
      const h = toDots(element.offsetHeight + 1);
      setMeasured((current) => (current.w === w && current.h === h ? current : { w, h }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [contentRef, measuresSomething]);
  return placement === undefined ? null : resolvePlacement(placement, grid, measured);
}

export interface IslandProps extends Omit<HTMLAttributes<HTMLDivElement>, "style"> {
  placement: GridPlacement;
  /** `"panel"` is the rounded card; `"pill"` fully rounds the ends. */
  shape?: "panel" | "pill";
  /** Caps an `"auto"` height, in dots; taller content scrolls inside the island. */
  maxHeight?: number;
  style?: CSSProperties;
  children: ReactNode;
}

/** A floating chrome surface snapped to the canvas dot grid. */
export const Island = forwardRef<HTMLDivElement, IslandProps>(function Island(
  { placement, shape = "panel", maxHeight, className, style, children, ...rest },
  ref,
) {
  const contentRef = useRef<HTMLDivElement>(null);
  const box = useGridBox(contentRef, placement);
  const capped = box !== null && maxHeight !== undefined && box.height > maxHeight * DOT_STEP;
  const height = capped ? maxHeight! * DOT_STEP : box?.height;
  // A bottom-anchored island keeps its bottom edge when capped; only its top moves down.
  const bottomAnchored = placement.t === undefined && !placement.cy;
  const top = box !== null && capped && bottomAnchored ? box.top + box.height - height! : box?.top;
  return (
    <div
      ref={ref}
      className={`${styles.island} ${shape === "pill" ? styles.pill : ""} ${placement.w === "auto" ? styles.autoWidth : ""} ${capped ? styles.scroll : ""} ${className ?? ""}`}
      style={{ ...box, top, height, ...style }}
      data-island=""
      {...rest}
    >
      <div ref={contentRef} className={styles.content}>{children}</div>
    </div>
  );
});
