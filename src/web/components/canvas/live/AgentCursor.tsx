import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useReactFlow, ViewportPortal } from "@xyflow/react";
import { emitScenePulse } from "../../backdrop";
import { countLabel } from "../../../lib/pluralize";
import type { BuildPlan } from "./buildPlan";
import styles from "./AgentCursor.module.css";

/**
 * The agent's pen: a cursor that flies along the build plan's path, inking each new edge and
 * tracing each new card while a label says what it is writing. It lives in the canvas viewport,
 * so it pans and zooms with the cards it draws. Each new card also sends a ripple through the
 * scene background from where it lands.
 */
export function AgentCursor({ plan }: { plan: BuildPlan }) {
  const cursorRef = useRef<HTMLDivElement>(null);
  const [label, setLabel] = useState<string | null>(null);
  const { flowToScreenPosition } = useReactFlow();

  useLayoutEffect(() => {
    const element = cursorRef.current;
    const keys = plan.cursor;
    if (element === null || keys.length === 0 || typeof element.animate !== "function") {
      return;
    }
    const total = plan.total;
    const first = keys[0]!;
    const frames: Keyframe[] = [
      { offset: 0, transform: `translate(${first.x}px, ${first.y}px) scale(0.6)`, opacity: 0 },
      ...keys.map((key) => ({ offset: key.t / (total + 700), transform: `translate(${key.x}px, ${key.y}px) scale(1)`, opacity: 1 })),
    ];
    const last = keys[keys.length - 1]!;
    frames.push({ offset: 1, transform: `translate(${last.x + 18}px, ${last.y + 22}px) scale(0.8)`, opacity: 0 });
    // Offsets must rise strictly; the first real key may share t=0 with the fade-in frame.
    for (let i = 1; i < frames.length; i += 1) {
      frames[i]!.offset = Math.min(1, Math.max(frames[i]!.offset as number, (frames[i - 1]!.offset as number) + 1e-6));
    }
    const animation = element.animate(frames, { duration: total + 700, easing: "linear", fill: "forwards" });
    return () => animation.cancel();
  }, [plan]);

  useEffect(() => {
    const timers = [
      ...plan.labels.map(({ t, text }) => window.setTimeout(() => setLabel(text), t)),
      ...plan.pulses.map(({ t, x, y }) => window.setTimeout(() => emitScenePulse(flowToScreenPosition({ x, y })), t)),
      window.setTimeout(() => setLabel(null), plan.total + 300),
    ];
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [flowToScreenPosition, plan]);

  if (plan.cursor.length === 0) {
    return null;
  }
  return (
    <ViewportPortal>
      <div ref={cursorRef} className={styles.cursor} data-agent-cursor="" aria-hidden="true">
        <svg className={styles.pointer} width="22" height="24" viewBox="0 0 22 24">
          <path d="M2 2 L2 19 L7 14.5 L10.5 22 L13.6 20.6 L10.2 13.2 L17 13.2 Z" />
        </svg>
        {label !== null ? (
          <span key={label} className={styles.label}>
            <span className={styles.labelDot} />
            {label}
          </span>
        ) : null}
      </div>
    </ViewportPortal>
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
      <span className={styles.toastFile}>{fileName}</span>
      <span className={styles.toastText}>{parts.join(" · ")}</span>
    </div>
  );
}
