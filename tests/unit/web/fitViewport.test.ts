import { describe, expect, it } from "vitest";
import { computeFitViewport, computeViewportOverflow } from "@web/components/canvas/fitViewport";

const BASE = {
  containerWidth: 1000,
  containerHeight: 800,
  minZoom: 0.5,
  maxZoom: 1.5,
  paddingRatio: 0.05,
};

describe("computeFitViewport", () => {
  it("rejects empty dimensions and fits ordinary content within zoom bounds", () => {
    expect(computeFitViewport({ ...BASE, containerWidth: 0, bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 } })).toBeNull();
    expect(computeFitViewport({ ...BASE, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } })).toBeNull();

    const fitted = computeFitViewport({ ...BASE, bounds: { minX: 0, minY: 0, maxX: 200, maxY: 200 } });
    expect(fitted).not.toBeNull();
    expect(fitted!.zoom).toBeCloseTo(BASE.maxZoom, 5);
    expect(fitted!.y + 100 * fitted!.zoom).toBeCloseTo(400, 1);
    expect(fitted).toEqual(expect.objectContaining({ overflowsRight: false, overflowsBottom: false }));

    const tiny = computeFitViewport({ ...BASE, bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 } });
    expect(tiny?.zoom).toBe(BASE.maxZoom);
  });

  it("clamps and aligns oversized content toward its readable starting edge", () => {
    const wide = computeFitViewport({ ...BASE, bounds: { minX: 0, minY: 0, maxX: 4000, maxY: 200 } });
    expect(wide).toEqual(expect.objectContaining({ zoom: BASE.minZoom, overflowsRight: true, overflowsBottom: false }));
    expect(wide!.x).toBeCloseTo(1000 * 0.05, 1);

    const tall = computeFitViewport({ ...BASE, bounds: { minX: 0, minY: 0, maxX: 200, maxY: 4000 } });
    expect(tall).toEqual(expect.objectContaining({ zoom: BASE.minZoom, overflowsBottom: true }));
    expect(tall!.y).toBeCloseTo(800 * 0.05, 1);
  });

  it("accounts for positive and negative graph-space origins without changing fit size", () => {
    const atOrigin = computeFitViewport({ ...BASE, bounds: { minX: 0, minY: 0, maxX: 200, maxY: 200 } })!;
    const positive = computeFitViewport({ ...BASE, bounds: { minX: 500, minY: 300, maxX: 700, maxY: 500 } })!;
    const negative = computeFitViewport({ ...BASE, bounds: { minX: -500, minY: -300, maxX: -300, maxY: -100 } })!;
    expect(positive.zoom).toBeCloseTo(atOrigin.zoom, 5);
    expect(negative.zoom).toBeCloseTo(atOrigin.zoom, 5);
    expect(negative.x + -400 * negative.zoom).toBeCloseTo(BASE.containerWidth / 2, 1);
    expect(negative.y + -200 * negative.zoom).toBeCloseTo(BASE.containerHeight / 2, 1);
  });

  it("clears directional overflow after the user pans to the graph end", () => {
    const bounds = { minX: 0, minY: 0, maxX: 4000, maxY: 1200 };
    expect(computeViewportOverflow({
      containerWidth: 1000,
      containerHeight: 800,
      bounds,
      viewport: { x: 50, y: 50, zoom: 0.5 },
    })).toEqual({ overflowsRight: true, overflowsBottom: false });
    expect(computeViewportOverflow({
      containerWidth: 1000,
      containerHeight: 800,
      bounds,
      viewport: { x: -1000, y: 200, zoom: 0.5 },
    })).toEqual({ overflowsRight: false, overflowsBottom: false });
  });
});
