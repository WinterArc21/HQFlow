/**
 * A deliberate replacement for React Flow's own `fitView`. `fitView` always centers the fitted
 * content, which is fine when everything fits — but once a workflow is tall enough that even the
 * clamped minimum readable zoom (contract §1: "clamp the minimum default zoom to something
 * legible") can't fit it, centering silently crops an equal sliver off both the top *and* the
 * bottom. That hides the workflow's entry step behind the header with no visual cue that more
 * content exists — the worst possible first impression of a tall workflow.
 *
 * This computes the same "fit" zoom `fitView` would, clamps it the same way, but when the fitted
 * content is taller than the viewport it anchors to the *top* instead of the centre: the entry
 * step stays fully visible, and the overflow is pushed to the bottom, where a reader already
 * expects to scroll for "what happens next".
 */
export interface FitViewportInput {
  containerWidth: number;
  containerHeight: number;
  /** Bounding box of the laid-out graph, in the same units as `LayoutNode.x/y/width/height`. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  minZoom: number;
  maxZoom: number;
  /** Fraction of the container reserved as margin on each side, same meaning as React Flow's
   * `fitView({ padding })`. */
  paddingRatio: number;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
  /** Whether the fitted content's right edge still falls beyond the container after
   * left-anchoring. */
  overflowsRight: boolean;
  /** Whether the fitted content's bottom edge still falls below the container even after
   * top-anchoring — i.e. panning down would reveal more graph. `WorkflowCanvas` uses this to
   * show a quiet "more below" affordance instead of letting a reader assume a cut-off card is
   * the whole workflow (a deeper depth or a large workflow can be taller than any zoom floor
   * allows, contract §11's progressive depth: "same canvas, same nodes — nodes grow"). */
  overflowsBottom: boolean;
}

export function computeViewportOverflow(input: Pick<FitViewportInput, "containerWidth" | "containerHeight" | "bounds"> & {
  viewport: Pick<Viewport, "x" | "y" | "zoom">;
}): Pick<Viewport, "overflowsRight" | "overflowsBottom"> {
  const { containerWidth, containerHeight, bounds, viewport } = input;
  return {
    overflowsRight: viewport.x + bounds.maxX * viewport.zoom > containerWidth,
    overflowsBottom: viewport.y + bounds.maxY * viewport.zoom > containerHeight,
  };
}

export function computeFitViewport(input: FitViewportInput): Viewport | null {
  const { containerWidth, containerHeight, bounds, minZoom, maxZoom, paddingRatio } = input;
  const boundsWidth = bounds.maxX - bounds.minX;
  const boundsHeight = bounds.maxY - bounds.minY;
  if (containerWidth <= 0 || containerHeight <= 0 || boundsWidth <= 0 || boundsHeight <= 0) {
    return null;
  }

  const paddingX = containerWidth * paddingRatio;
  const paddingY = containerHeight * paddingRatio;
  const availableWidth = Math.max(containerWidth - paddingX * 2, 1);
  const availableHeight = Math.max(containerHeight - paddingY * 2, 1);

  const rawZoom = Math.min(availableWidth / boundsWidth, availableHeight / boundsHeight);
  const zoom = Math.min(Math.max(rawZoom, minZoom), maxZoom);

  const contentWidth = boundsWidth * zoom;
  const contentHeight = boundsHeight * zoom;

  const x = contentWidth <= availableWidth ? (containerWidth - contentWidth) / 2 - bounds.minX * zoom : paddingX - bounds.minX * zoom;
  const y =
    contentHeight <= availableHeight
      ? (containerHeight - contentHeight) / 2 - bounds.minY * zoom
      : paddingY - bounds.minY * zoom;

  const overflow = computeViewportOverflow({
    containerWidth,
    containerHeight,
    bounds,
    viewport: { x, y, zoom },
  });

  return {
    x,
    y,
    zoom,
    ...overflow,
  };
}
