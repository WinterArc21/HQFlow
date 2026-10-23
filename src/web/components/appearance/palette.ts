import type { CategoryKey } from "../../design/scenes";
import type { Theme } from "../../store/useCodeHQStore";

type Rgb = [number, number, number];

function hslToRgb(hue: number, saturation: number, lightness: number): Rgb {
  const k = (n: number) => (n + hue / 30) % 12;
  const a = saturation * Math.min(lightness, 1 - lightness);
  const channel = (n: number) => Math.round((lightness - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))) * 255);
  return [channel(0), channel(8), channel(4)];
}

/** WCAG relative luminance of 0-255 sRGB channels. */
export function luminance([r, g, b]: Rgb): number {
  const linear = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

export function contrast(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function toHex(rgb: Rgb): string {
  return `#${rgb.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

/** On light scenes a card colour is read against white; on dark ones against near-black. */
export const PALETTE_CONTRAST = { light: 4.6, dark: 8 } as const;

/**
 * The most vivid lightness for a hue that still clears the family's contrast bar: the lightest
 * one that passes against white on light scenes, the darkest that passes against black on dark.
 * Yellow needs to sit much darker than blue for the same contrast, so this is solved per hue.
 */
function legibleColor(hue: number, base: Theme): Rgb {
  const saturation = base === "dark" ? 0.75 : 0.7;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 18; i += 1) {
    const mid = (lo + hi) / 2;
    const lum = luminance(hslToRgb(hue, saturation, mid));
    const passes = base === "light" ? contrast(lum, 1) >= PALETTE_CONTRAST.light : contrast(lum, 0) >= PALETTE_CONTRAST.dark;
    if (passes === (base === "light")) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return hslToRgb(hue, saturation, base === "light" ? lo : hi);
}

/**
 * A fresh, evenly spaced set of card colours: five hues 72deg apart from a random start (entry and
 * output share one, as they do by default), each at the most vivid lightness that keeps contrast.
 */
export function shuffledPalette(base: Theme, random: () => number = Math.random): Record<CategoryKey, string> {
  const start = random() * 360;
  const hue = (slot: number) => toHex(legibleColor((start + slot * 72) % 360, base));
  return {
    entry: hue(0),
    logic: hue(1),
    decision: hue(2),
    data: hue(3),
    external: hue(4),
    output: hue(0),
  };
}
