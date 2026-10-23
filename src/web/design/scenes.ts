/**
 * Scenes are whole-app looks: a background (a live shader, or the plain dot field), the surface
 * and text tokens that sit on it, and card colours tuned to read against it. Every colour lives
 * in `styles/tokens.css` under `:root[data-scene="<id>"]`; this table only names each scene, says
 * which theme family it belongs to, and which shader paints its background.
 */
import type { Theme } from "../store/useCodeHQStore";

export type ShaderId = "ember" | "abyss" | "nebula" | "sorbet" | "topo" | "riso" | "dawn";

export interface Scene {
  id: string;
  name: string;
  /** The light/dark family; drives `data-theme`, so every base token and React Flow follow it. */
  base: Theme;
  /** `null` keeps the CSS dot field: the original, calmest look. */
  shader: ShaderId | null;
  /** One line for the picker. */
  tagline: string;
  /** Halftone scenes render at device resolution, unsmoothed. */
  crisp?: boolean;
  /** Dither scenes: CSS pixels per dither cell. The shader renders exactly one pixel per cell. */
  pixel?: number;
}

export const SCENES: readonly Scene[] = [
  { id: "graphite", name: "Graphite", base: "dark", shader: null, tagline: "The quiet original. Dots on charcoal." },
  { id: "nebula", name: "Nebula", base: "dark", shader: "nebula", tagline: "Violet gas clouds and a slow starfield." },
  { id: "abyss", name: "Abyss", base: "dark", shader: "abyss", tagline: "Caustic light on a deep ocean floor." },
  { id: "ember", name: "Ember", base: "dark", shader: "ember", tagline: "Ordered-dither heat, rising like a forge.", pixel: 3 },
  { id: "paper", name: "Paper", base: "light", shader: null, tagline: "Warm paper and a quiet dot grid." },
  { id: "sorbet", name: "Sorbet", base: "light", shader: "sorbet", tagline: "A soft pastel mesh with film grain." },
  { id: "riso", name: "Riso", base: "light", shader: "riso", tagline: "Two-ink halftone that breathes on the grid.", crisp: true },
  { id: "topo", name: "Topo", base: "light", shader: "topo", tagline: "Contour lines of a slowly shifting terrain." },
  { id: "dawn", name: "Pixel Dawn", base: "light", shader: "dawn", tagline: "A dithered pastel sky at first light.", pixel: 4 },
];

export const DEFAULT_SCENE: Record<Theme, string> = { dark: "graphite", light: "paper" };

export function findScene(id: string | undefined): Scene | undefined {
  return SCENES.find((scene) => scene.id === id);
}

/** A known scene of the given family, falling back to that family's default. */
export function sceneFor(id: string | undefined, base: Theme): Scene {
  const scene = findScene(id);
  return scene !== undefined && scene.base === base ? scene : findScene(DEFAULT_SCENE[base])!;
}

export const CATEGORY_KEYS = ["entry", "logic", "decision", "data", "external", "output"] as const;
export type CategoryKey = (typeof CATEGORY_KEYS)[number];
