/** Longest distance from the corner a card grows out of to its far corner, plus the soft edge. */
const FEATHER = 70;
const OPEN_MS = 620;
const CLOSE_MS = 160;
const EASE_OPEN = "cubic-bezier(0.3, 0.6, 0.3, 1)";

/**
 * Opens a card with an iris: a soft circle of the card spreads from the corner it grows out of,
 * with a ring in the step's accent riding its front. The circle is a CSS mask whose radius
 * (`--iris-r`, registered in StepCard.module.css) is animated, so there is no per-frame script.
 * Closing is a short fade. Returns null when it cannot or should not play (still motion, no
 * Web Animations), so the caller acts at once.
 */
export function irisReveal(
  card: HTMLElement,
  ring: HTMLElement,
  { fromRight, closing }: { fromRight: boolean; closing: boolean },
): Promise<void> | null {
  if (document.documentElement.getAttribute("data-motion") === "still" || typeof card.animate !== "function") {
    return null;
  }

  if (closing) {
    // `scale` (not `transform`) composes with the card's positioning transform.
    const fade = card.animate(
      [{ opacity: 1, scale: "1" }, { opacity: 0, scale: "0.97" }],
      { duration: CLOSE_MS, easing: "ease-in", fill: "forwards" },
    );
    return fade.finished.then(() => undefined);
  }

  const reach = Math.hypot(card.offsetWidth, card.offsetHeight) + FEATHER;
  card.style.setProperty("--iris-x", fromRight ? "100%" : "0px");
  card.dataset.iris = "";
  const spread = card.animate([{ "--iris-r": "0px" }, { "--iris-r": `${Math.ceil(reach)}px` }], { duration: OPEN_MS, easing: EASE_OPEN, fill: "both" });
  const glow = ring.animate([{ opacity: 1 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], { duration: OPEN_MS, fill: "both" });
  const done = () => {
    spread.cancel();
    glow.cancel();
    delete card.dataset.iris;
  };
  return spread.finished.then(done, done);
}
