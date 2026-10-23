/**
 * Resolves any CSS colour expression (`var(--x)`, `color-mix(...)`) to 0-255 channels by letting
 * the browser compute it on a hidden probe. `scope` lets a caller read another scene's tokens
 * through `[data-scene-probe]` without applying that scene.
 */
export function readCssColor(expression: string, scope?: string): [number, number, number] {
  const probe = document.createElement("span");
  probe.style.display = "none";
  probe.style.color = expression;
  if (scope !== undefined) {
    probe.setAttribute("data-scene-probe", scope);
  }
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  const channels = computed.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
  // `color(srgb r g b)` reports 0-1 floats; the legacy form reports 0-255 integers.
  const unit = computed.startsWith("color(") ? 255 : 1;
  return [channels[0]! * unit, channels[1]! * unit, channels[2]! * unit].map((value) => Math.round(value)) as [number, number, number];
}

/** `#rrggbb` for an `<input type="color">`. */
export function toHexColor([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}
