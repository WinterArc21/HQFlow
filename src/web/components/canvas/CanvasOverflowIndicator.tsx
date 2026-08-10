import { CaretDown, CaretRight } from "@phosphor-icons/react";
import styles from "./WorkflowCanvas.module.css";

/**
 * A quiet overflow affordance (contract mandate: a user must never believe they're seeing
 * the whole graph when they aren't). `WorkflowCanvas` renders this only when `fitViewport.ts`
 * reports that the fitted graph extends beyond the visible stage. Purely decorative:
 * panning/scrolling already works, this only says it's worth doing.
 */
export function CanvasOverflowIndicator({ direction }: { direction: "right" | "bottom" }) {
  const isRight = direction === "right";
  return (
    <div
      className={`${styles.overflowFade} ${isRight ? styles.overflowFadeRight : styles.overflowFadeBottom}`}
      aria-hidden="true"
    >
      <span className={styles.overflowLabel}>
        {isRight ? null : <CaretDown size={11} weight="bold" />}
        {isRight ? "More" : "More below"}
        {isRight ? <CaretRight size={11} weight="bold" /> : null}
      </span>
    </div>
  );
}
