/**
 * Scenes are whole-app looks: a background (a live shader, or the plain dot field), the surface
 * and text tokens that sit on it, and card colours tuned to read against it. Every colour lives
 * in `styles/tokens.css` under `:root[data-scene="<id>"]`; this table only names each scene, says
 * which theme family it belongs to, and which shader paints its background.
 */
import type { Theme } from "../store/useCodeHQStore";

export type ShaderId = "mesh";

export interface Scene {
  id: string;
  name: string;
  /** The light/dark family; drives `data-theme`, so every base token and React Flow follow it. */
  base: Theme;
  /** `null` keeps the CSS dot field: the original, calmest look. */
  shader: ShaderId | null;
  /** One line for the picker. */
  tagline: string;
}

export const SCENES: readonly Scene[] = [
  { id: "graphite", name: "Graphite", base: "dark", shader: null, tagline: "The quiet original. Dots on charcoal." },
  { id: "abyss-mesh", name: "Abyss Mesh", base: "dark", shader: "mesh", tagline: "Deep teal and pink, blended soft with film grain." },
  { id: "silk-mesh", name: "Silk Mesh", base: "dark", shader: "mesh", tagline: "Violet, rose and peach, blended soft with film grain." },
  { id: "tide-mesh", name: "Tide Mesh", base: "dark", shader: "mesh", tagline: "Navy and ice blue, blended soft with film grain." },
  { id: "paper", name: "Paper", base: "light", shader: null, tagline: "Warm paper and a quiet dot grid." },
  { id: "sorbet", name: "Sorbet", base: "light", shader: "mesh", tagline: "A soft pastel mesh with film grain." },
];

export const DEFAULT_SCENE: Record<Theme, string> = { dark: "abyss-mesh", light: "sorbet" };

export function findScene(id: string | undefined): Scene | undefined {
  return SCENES.find((scene) => scene.id === id);
}

/** A known scene of the given family, falling back to that family's default. */
export function sceneFor(id: string | undefined, base: Theme): Scene {
  const scene = findScene(id);
  return scene !== undefined && scene.base === base ? scene : findScene(DEFAULT_SCENE[base])!;
}
