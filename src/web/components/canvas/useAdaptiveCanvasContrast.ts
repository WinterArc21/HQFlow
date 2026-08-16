import { useCallback, useEffect, useRef, type RefObject } from "react";

interface SampledImage {
  data: ImageData;
  sourceWidth: number;
  sourceHeight: number;
}

const MAX_SAMPLE_DIMENSION = 512;
/* White and near-black text have equal WCAG contrast at about 0.18 relative luminance. A small
 * margin accounts for the card's neutral tint and blurred pixels around each sample. */
const LIGHT_TEXT_THRESHOLD = 0.2;

function linearChannel(value: number): number {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function pixelLuminance(data: Uint8ClampedArray, offset: number): number {
  return 0.2126 * linearChannel(data[offset] ?? 0)
    + 0.7152 * linearChannel(data[offset + 1] ?? 0)
    + 0.0722 * linearChannel(data[offset + 2] ?? 0);
}

function sampleCardLuminance(image: SampledImage, stageRect: DOMRect, cardRect: DOMRect): number {
  const coverScale = Math.max(stageRect.width / image.sourceWidth, stageRect.height / image.sourceHeight);
  const renderedWidth = image.sourceWidth * coverScale;
  const renderedHeight = image.sourceHeight * coverScale;
  const offsetX = (stageRect.width - renderedWidth) / 2;
  const offsetY = (stageRect.height - renderedHeight) / 2;
  let luminance = 0;
  let samples = 0;

  for (const yRatio of [0.2, 0.5, 0.8]) {
    for (const xRatio of [0.12, 0.3, 0.5, 0.7, 0.88]) {
      const stageX = cardRect.left - stageRect.left + cardRect.width * xRatio;
      const stageY = cardRect.top - stageRect.top + cardRect.height * yRatio;
      const sourceX = (stageX - offsetX) / coverScale;
      const sourceY = (stageY - offsetY) / coverScale;
      const pixelX = Math.max(0, Math.min(image.data.width - 1, Math.round(sourceX / image.sourceWidth * image.data.width)));
      const pixelY = Math.max(0, Math.min(image.data.height - 1, Math.round(sourceY / image.sourceHeight * image.data.height)));
      const pixelOffset = (pixelY * image.data.width + pixelX) * 4;
      luminance += pixelLuminance(image.data.data, pixelOffset);
      samples += 1;
    }
  }

  return luminance / samples;
}

/** Selects readable card text from the image pixels currently behind each movable node. */
export function useAdaptiveCanvasContrast(
  containerRef: RefObject<HTMLDivElement | null>,
  imageUrl: string | null,
): () => void {
  const imageRef = useRef<SampledImage | null>(null);
  const frameRef = useRef<number | null>(null);

  const updateCardContrast = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
    }
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const stage = containerRef.current;
      const image = imageRef.current;
      if (stage === null) {
        return;
      }
      const cards = stage.querySelectorAll<HTMLElement>("[data-step-node]");
      if (image === null) {
        cards.forEach((card) => delete card.dataset.cardText);
        return;
      }
      const stageRect = stage.getBoundingClientRect();
      cards.forEach((card) => {
        const luminance = sampleCardLuminance(image, stageRect, card.getBoundingClientRect());
        card.dataset.cardText = luminance < LIGHT_TEXT_THRESHOLD ? "light" : "dark";
      });
    });
  }, [containerRef]);

  useEffect(() => {
    imageRef.current = null;
    updateCardContrast();
    if (imageUrl === null) {
      return;
    }

    let cancelled = false;
    const image = new Image();
    image.addEventListener("load", () => {
      if (cancelled || image.naturalWidth === 0 || image.naturalHeight === 0) {
        return;
      }
      const scale = Math.min(1, MAX_SAMPLE_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (context === null) {
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      imageRef.current = {
        data: context.getImageData(0, 0, canvas.width, canvas.height),
        sourceWidth: image.naturalWidth,
        sourceHeight: image.naturalHeight,
      };
      updateCardContrast();
    });
    image.src = imageUrl;
    return () => {
      cancelled = true;
    };
  }, [imageUrl, updateCardContrast]);

  useEffect(() => {
    const stage = containerRef.current;
    if (stage === null || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(updateCardContrast);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [containerRef, updateCardContrast]);

  useEffect(() => () => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
    }
  }, []);

  return updateCardContrast;
}
