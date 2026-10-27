/** Flow units per dither cell; the card is drawn in flow units, so cells zoom with the board. */
const CELL = 6;
const OPEN_MS = 560;
const CLOSE_MS = 320;
/** How far behind the front a cell still glows in the step's accent. */
const GLOW_BAND = 0.14;

/** 8×8 Bayer thresholds in (0, 1): the same ordered dither the scene shaders use. */
const BAYER = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22, 3, 35,
  11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
].map((value) => (value + 0.5) / 64);

/**
 * Reveals (or, when `closing`, hides) the card through ordered-dither pixels that spread from
 * the corner it grows out of. The newest pixels glow in the step's accent on `glow`.
 * Returns null when it cannot or should not play (still motion, no layout, no 2D canvas), so the caller
 * acts at once.
 */
export function ditherDissolve(
  card: HTMLElement,
  glow: HTMLCanvasElement,
  { fromRight, closing }: { fromRight: boolean; closing: boolean },
): Promise<void> | null {
  if (document.documentElement.getAttribute("data-motion") === "still") {
    return null;
  }
  const cols = Math.ceil(card.offsetWidth / CELL);
  const rows = Math.ceil(card.offsetHeight / CELL);
  if (cols === 0 || rows === 0) {
    return null;
  }
  const mask = document.createElement("canvas");
  mask.width = glow.width = cols;
  mask.height = glow.height = rows;
  const maskCtx = mask.getContext("2d");
  const glowCtx = glow.getContext("2d");
  if (maskCtx === null || glowCtx === null) {
    return null;
  }
  glowCtx.fillStyle = getComputedStyle(card).getPropertyValue("--step-accent").trim();
  const maskData = maskCtx.createImageData(cols, rows);
  const duration = closing ? CLOSE_MS : OPEN_MS;
  const start = performance.now();
  card.style.imageRendering = "pixelated";

  const draw = (progress: number) => {
    glowCtx.clearRect(0, 0, cols, rows);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        // Distance from the anchor corner, 0..1; the front travels past the far corner by the end.
        const distance = Math.hypot((fromRight ? cols - 1 - x : x) / cols, (y / rows) * 0.8) / 1.28;
        const level = progress * 1.6 - distance * 0.9 - BAYER[(y % 8) * 8 + (x % 8)]!;
        maskData.data[(y * cols + x) * 4 + 3] = level > 0 ? 255 : 0;
        if (level > 0 && level < GLOW_BAND) {
          glowCtx.globalAlpha = 1 - level / GLOW_BAND;
          glowCtx.fillRect(x, y, 1, 1);
        }
      }
    }
    maskCtx.putImageData(maskData, 0, 0);
    card.style.maskImage = `url(${mask.toDataURL()})`;
    card.style.maskSize = "100% 100%";
  };

  // The first frame lands before paint, so an opening card never flashes in whole.
  draw(closing ? 1 : 0);
  return new Promise((resolve) => {
    const frame = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // Ease out on open, ease in on close.
      const eased = closing ? 1 - t * t : 1 - (1 - t) * (1 - t);
      if (t < 1 && card.isConnected) {
        draw(eased);
        requestAnimationFrame(frame);
        return;
      }
      // A closed card stays hidden until it unmounts; an opened one drops the mask.
      if (closing) {
        draw(0);
      } else {
        card.style.maskImage = card.style.maskSize = card.style.imageRendering = "";
      }
      glowCtx.clearRect(0, 0, cols, rows);
      resolve();
    };
    requestAnimationFrame(frame);
  });
}
