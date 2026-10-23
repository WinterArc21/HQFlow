import { describe, expect, it } from "vitest";
import { contrast, luminance, PALETTE_CONTRAST, shuffledPalette } from "@web/components/appearance/palette";

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)) as [number, number, number];
}

describe("shuffledPalette", () => {
  // Every start hue in 5deg steps, so the hard ones (yellow on paper, blue on black) are covered.
  const starts = Array.from({ length: 72 }, (_, i) => i / 72);

  it("keeps every colour legible on light scenes, including yellows", () => {
    for (const start of starts) {
      for (const color of Object.values(shuffledPalette("light", () => start))) {
        expect(contrast(luminance(channels(color)), 1), color).toBeGreaterThanOrEqual(PALETTE_CONTRAST.light);
      }
    }
  });

  it("keeps every colour bright enough on dark scenes, including blues", () => {
    for (const start of starts) {
      for (const color of Object.values(shuffledPalette("dark", () => start))) {
        expect(contrast(luminance(channels(color)), 0), color).toBeGreaterThanOrEqual(PALETTE_CONTRAST.dark);
      }
    }
  });

  it("gives the five middle slots distinct colours and pairs entry with output", () => {
    const palette = shuffledPalette("dark", () => 0.3);
    expect(palette.entry).toBe(palette.output);
    expect(new Set([palette.entry, palette.logic, palette.decision, palette.data, palette.external]).size).toBe(5);
  });
});
