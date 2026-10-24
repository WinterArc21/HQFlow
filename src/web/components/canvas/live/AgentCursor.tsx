import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useReactFlow, ViewportPortal } from "@xyflow/react";
import { emitScenePulse } from "../../backdrop";
import { countLabel } from "../../../lib/pluralize";
import { CARD_PHASE, WEAVE_SWING, type BuildPlan, type CardDraw, type CursorKey } from "./buildPlan";
import styles from "./AgentCursor.module.css";

/** Each cursor's name-tag dot, so several agents drawing at once read as different hands. */
const CURSOR_COLORS = ["var(--accent-blue)", "var(--accent-amber)", "var(--accent-violet)", "var(--accent-cyan)"];
/** Time after the build for the cursors to leave. */
const LEAVE_MS = 700;
const RIDE_SAMPLES = 16;
/** Matches the ink's `cubic-bezier(0.65, 0, 0.35, 1)` closely enough to keep the pen on the drop. */
const inkEase = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

/** Replaces each edge ride (a key with `edge` and the key after it) with points on the drawn path. */
function rideEdges(keys: CursorKey[], root: ParentNode): CursorKey[] {
  const result: CursorKey[] = [];
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i]!;
    const end = keys[i + 1];
    const path = key.edge !== undefined && end !== undefined
      ? root.querySelector<SVGPathElement>(`[data-workflow-edge="${CSS.escape(key.edge)}"] path[data-edge-halo]`)
      : null;
    if (path === null || end === undefined || typeof path.getTotalLength !== "function") {
      result.push(key);
      continue;
    }
    const length = path.getTotalLength();
    for (let k = 0; k <= RIDE_SAMPLES; k += 1) {
      const share = k / RIDE_SAMPLES;
      const point = path.getPointAtLength(length * inkEase(share));
      result.push({ t: key.t + (end.t - key.t) * share, x: point.x, y: point.y });
    }
    i += 1;
  }
  return result;
}

function penFrames(keys: CursorKey[], total: number): Keyframe[] {
  const span = total + LEAVE_MS;
  const first = keys[0]!;
  const last = keys[keys.length - 1]!;
  const at = (point: CursorKey, scale: number) => `translate(${point.x}px, ${point.y}px) scale(${scale})`;
  const frames: Keyframe[] = [
    { offset: 0, transform: at(first, 0.6), opacity: 0 },
    { offset: Math.max(0, first.t - 180) / span, transform: at(first, 0.6), opacity: 0 },
    ...keys.map((key) => ({ offset: key.t / span, transform: at(key, 1), opacity: 1 })),
    { offset: (last.t + 400) / span, transform: at({ ...last, x: last.x + 18, y: last.y + 22 }, 0.8), opacity: 0 },
    { offset: 1, transform: at({ ...last, x: last.x + 18, y: last.y + 22 }, 0.8), opacity: 0 },
  ];
  // Offsets must rise strictly and stay within the timeline.
  for (let i = 1; i < frames.length; i += 1) {
    frames[i]!.offset = Math.min(1, Math.max(frames[i]!.offset as number, (frames[i - 1]!.offset as number) + 1e-6));
  }
  return frames;
}

/**
 * The agents' pens: cursors that ride the build plan's paths, inking each new edge and dragging
 * and weaving each new card while a name tag says what they are drawing. They live in the canvas
 * viewport, so they pan and zoom with the cards they draw. Each new card also sends a ripple
 * through the scene background from where it lands.
 */
export function AgentCursor({ plan }: { plan: BuildPlan }) {
  const penRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [labels, setLabels] = useState<Array<string | null>>(() => plan.cursors.map(() => null));
  const { flowToScreenPosition } = useReactFlow();

  useLayoutEffect(() => {
    // The CSS that draws the cards starts now; the pens start from the same moment. They wait two
    // frames for the new edges to render, so they can ride their real paths.
    const startedAt = performance.now();
    const animations: Animation[] = [];
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        plan.cursors.forEach((keys, index) => {
          const pen = penRefs.current[index];
          if (pen === null || pen === undefined || keys.length === 0 || typeof pen.animate !== "function") {
            return;
          }
          const ridden = rideEdges(keys, pen.ownerDocument);
          const animation = pen.animate(penFrames(ridden, plan.total), { duration: plan.total + LEAVE_MS, easing: "linear", fill: "forwards" });
          animation.currentTime = performance.now() - startedAt;
          animations.push(animation);
        });
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      animations.forEach((animation) => animation.cancel());
    };
  }, [plan]);

  useEffect(() => {
    const say = (cursor: number, text: string | null) =>
      setLabels((current) => current.map((label, index) => (index === cursor ? text : label)));
    const timers = [
      ...plan.labels.map(({ t, text, cursor }) => window.setTimeout(() => say(cursor, text), t)),
      ...plan.pulses.map(({ t, x, y }) => window.setTimeout(() => emitScenePulse(flowToScreenPosition({ x, y })), t)),
      window.setTimeout(() => setLabels(plan.cursors.map(() => null)), plan.total + 300),
    ];
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [flowToScreenPosition, plan]);

  if (plan.cursors.length === 0) {
    return null;
  }
  return (
    <ViewportPortal>
      <WeaveTiles cards={plan.cards} />
      {plan.cursors.map((_, index) => (
        <div
          key={index}
          ref={(element) => {
            penRefs.current[index] = element;
          }}
          className={styles.cursor}
          data-agent-cursor=""
          aria-hidden="true"
          style={{ "--pen-color": CURSOR_COLORS[index % CURSOR_COLORS.length] } as CSSProperties}
        >
          <svg className={styles.pointer} width="22" height="24" viewBox="0 0 22 24">
            <path d="M4.3 3.2C3.8 2.7 3 3.1 3 3.8L3.4 19.4C3.4 20.2 4.4 20.5 4.9 19.9L8.7 15.6C9 15.3 9.4 15.1 9.8 15.1L15.5 15.1C16.3 15.1 16.7 14.2 16.1 13.6Z" />
          </svg>
          {labels[index] !== null && labels[index] !== undefined ? (
            <span key={labels[index]} className={styles.label}>
              <span className={styles.labelDot} />
              {labels[index]}
            </span>
          ) : null}
        </div>
      ))}
    </ViewportPortal>
  );
}

/**
 * The weave: tiles in the card's colour fly off the pen's tip as it sweeps back across the
 * marquee, and land in place. They clear away when the card appears. Pure CSS, timed from mount.
 */
function WeaveTiles({ cards }: { cards: CardDraw[] }) {
  const dense = cards.length <= 12;
  return (
    <div className={styles.tiles} aria-hidden="true">
      {cards.flatMap((card, cardIndex) => {
        const cols = card.outcome ? 8 : dense ? 12 : 8;
        const rows = card.outcome ? 2 : dense ? 4 : 3;
        const tileW = card.width / cols;
        const tileH = card.height / rows;
        const middle = card.y + card.height / 2;
        const fly = Math.min(260, card.duration * 0.3);
        const corner = card.outcome ? `${tileH}px` : "8px";
        const tiles = [];
        for (let row = 0; row < rows; row += 1) {
          for (let col = 0; col < cols; col += 1) {
            // The pen crosses this column at `u` of the way through its right-to-left sweep.
            const u = 1 - (col + 0.5) / cols;
            const at = card.delay + card.duration * (CARD_PHASE.HOP + (CARD_PHASE.WEAVE - CARD_PHASE.HOP) * u);
            const x = card.x + col * tileW;
            const y = card.y + row * tileH;
            const penX = card.x + card.width * (1 - u);
            const penY = middle + Math.sin(u * Math.PI * 3) * card.height * WEAVE_SWING;
            const seed = row * 7 + col * 13 + cardIndex * 5;
            const radius = [
              row === 0 && col === 0,
              row === 0 && col === cols - 1,
              row === rows - 1 && col === cols - 1,
              row === rows - 1 && col === 0,
            ].map((round) => (round ? corner : "2px")).join(" ");
            tiles.push(
              <span
                key={`${card.id}:${row}:${col}`}
                className={styles.tile}
                style={{
                  left: x,
                  top: y,
                  width: tileW - 1.5,
                  height: tileH - 1.5,
                  borderRadius: radius,
                  background: `color-mix(in srgb, ${card.accent} ${30 + (seed % 12) * 5}%, transparent)`,
                  "--tile-dx": `${penX - x}px`,
                  "--tile-dy": `${penY - y}px`,
                  "--tile-rot": `${(seed * 37) % 180 - 90}deg`,
                  "--tile-at": `${at}ms`,
                  "--tile-fly": `${fly}ms`,
                  "--tile-out": `${card.delay + card.duration * CARD_PHASE.WEAVE + 120 + col * 14}ms`,
                } as CSSProperties}
              />,
            );
          }
        }
        return tiles;
      })}
    </div>
  );
}

/** What just changed, said once at the top of the stage while the build draws. */
export function BuildToast({ plan, fileName }: { plan: BuildPlan; fileName: string }) {
  const parts = [
    plan.added > 0 ? `${countLabel(plan.added, "step")} added` : null,
    plan.changed.size > 0 ? `${countLabel(plan.changed.size, "step")} updated` : null,
    plan.connections > 0 ? countLabel(plan.connections, "connection") : null,
  ].filter((part): part is string => part !== null);
  return (
    <div className={styles.toast} role="status" style={{ animationDuration: `${plan.total + 1500}ms` }}>
      <span className={styles.toastPulse} aria-hidden="true" />
      <span className={styles.toastFile}>{plan.cursors.length > 1 ? `${plan.cursors.length} agents · ${fileName}` : fileName}</span>
      <span className={styles.toastText}>{parts.join(" · ")}</span>
    </div>
  );
}
