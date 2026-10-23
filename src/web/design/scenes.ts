/**
 * Scenes are whole-app looks: a background painted by a live shader, the surface
 * and text tokens that sit on it, and card colours tuned to read against it. Every colour lives
 * in `styles/tokens.css` under `:root[data-scene="<id>"]`; this table only names each scene, says
 * which theme family it belongs to, and which shader paints its background.
 */
import type { Theme } from "../store/useCodeHQStore";

export type ShaderId = "abyss" | "silk" | "tide" | "sorbet" | "dawn";

export interface Scene {
  id: string;
  name: string;
  /** The light/dark family; drives `data-theme`, so every base token and React Flow follow it. */
  base: Theme;
  shader: ShaderId;
  /** One line for the picker. */
  tagline: string;
  /** Dither scenes: CSS pixels per dither cell. The shader renders exactly one pixel per cell. */
  pixel?: number;
}

export const SCENES: readonly Scene[] = [
  { id: "abyss", name: "Abyss", base: "dark", shader: "abyss", tagline: "Caustic light on a deep ocean floor." },
  { id: "silk", name: "Silk", base: "dark", shader: "silk", tagline: "Dithered satin folding over itself.", pixel: 2 },
  { id: "tide", name: "Tide", base: "dark", shader: "tide", tagline: "Moonlit swells rolling under the map.", pixel: 2 },
  { id: "sorbet", name: "Sorbet", base: "light", shader: "sorbet", tagline: "A soft pastel mesh with film grain." },
  { id: "dawn", name: "Pixel Dawn", base: "light", shader: "dawn", tagline: "A dithered pastel sky at first light.", pixel: 4 },
];

export const DEFAULT_SCENE: Record<Theme, string> = { dark: "abyss", light: "sorbet" };

export function findScene(id: string | undefined): Scene | undefined {
  return SCENES.find((scene) => scene.id === id);
}

/** A known scene of the given family, falling back to that family's default. */
export function sceneFor(id: string | undefined, base: Theme): Scene {
  const scene = findScene(id);
  return scene !== undefined && scene.base === base ? scene : findScene(DEFAULT_SCENE[base])!;
}
