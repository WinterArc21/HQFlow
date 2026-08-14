import { ViewportPortal } from "@xyflow/react";
import { useMemo, type CSSProperties } from "react";
import type { PresenceConstructEffect } from "./livePresence";
import type { PresenceNodeBox } from "./cardGeometry";
import styles from "./LiveCardConstruct.module.css";

export interface LiveCardConstructProps {
  box: PresenceNodeBox | null;
  durationMs: number;
  effect: PresenceConstructEffect | null;
  accent: string;
}

const PIXEL_COLUMNS = 16;
const PIXEL_ROWS = 8;

/** Pixels on start/end cards, bloom on the rest. The kite cursor shoves the card in from the left. */
export function LiveCardConstruct({ box, durationMs, effect, accent }: LiveCardConstructProps) {
  const cells = useMemo(() => {
    const next: Array<{ column: number; row: number }> = [];
    for (let row = 0; row < PIXEL_ROWS; row += 1) {
      for (let column = 0; column < PIXEL_COLUMNS; column += 1) {
        next.push({ column, row });
      }
    }
    return next;
  }, []);

  if (box === null || effect === null) {
    return null;
  }

  const duration = `${Math.max(durationMs, 1)}ms`;

  return (
    <ViewportPortal>
      <div
        className={styles.layer}
        data-card-construct={box.id}
        data-presence-effect={effect}
        aria-hidden="true"
        style={{
          left: box.x,
          top: box.y,
          width: box.width,
          height: box.height,
          borderRadius: box.radius,
          "--presence-construct-ms": duration,
          "--presence-construct-accent": accent,
        } as CSSProperties}
      >
        {effect === "bloom" ? <span className={styles.bloom} /> : null}
        {effect === "pixels"
          ? cells.map((cell) => (
              <span
                key={`${cell.column}-${cell.row}`}
                className={styles.pixel}
                style={{
                  "--pixel-column": String(cell.column),
                  "--pixel-row": String(cell.row),
                } as CSSProperties}
              />
            ))
          : null}
      </div>
    </ViewportPortal>
  );
}
