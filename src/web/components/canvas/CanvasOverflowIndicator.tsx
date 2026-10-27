import { CaretDown, CaretRight } from "@phosphor-icons/react";
import styles from "./WorkflowCanvas.module.css";

/**
 * A quiet overflow affordance (contract mandate: a user must never believe they're seeing
 * the whole graph when they aren't). `WorkflowCanvas` renders this only when `fitViewport.ts`
 * reports that the fitted graph extends beyond the visible stage. A soft fade runs along the
 * edge, and a tab on that edge pans toward the rest of the map.
 */
export function CanvasOverflowIndicator({ direction, onPan, bottomInset = 0 }: {
  direction: "right" | "bottom";
  onPan: (direction: "right" | "bottom") => void;
  /** Pixels covered by chrome along the bottom edge; the bottom cue sits above them. */
  bottomInset?: number;
}) {
  const isRight = direction === "right";
  return (
    <div
      className={`${styles.overflowFade} ${isRight ? styles.overflowFadeRight : styles.overflowFadeBottom}`}
      style={isRight ? undefined : { height: bottomInset + 56, paddingBottom: bottomInset + 8 }}
    >
      <button
        type="button"
        className={`${styles.overflowLabel} ${isRight ? styles.overflowLabelRight : ""}`}
        aria-label={isRight ? "Show more to the right" : "Show more below"}
        onClick={() => onPan(direction)}
      >
        {isRight ? null : <CaretDown size={11} weight="bold" aria-hidden="true" />}
        {isRight ? "More" : "More below"}
        {isRight ? <CaretRight size={11} weight="bold" aria-hidden="true" /> : null}
      </button>
    </div>
  );
}
