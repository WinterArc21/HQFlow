import { ViewportPortal, useViewport } from "@xyflow/react";
import type { Ref } from "react";
import type { PresencePhase } from "./livePresence";
import styles from "./LiveAgentCursor.module.css";

export interface LiveAgentCursorProps {
  cursorRef: Ref<HTMLDivElement>;
  visible: boolean;
  phase: PresencePhase | null;
  operation: string | null;
}

/** One screen-sized kite cursor in flow space. It follows pan and zoom through ViewportPortal. */
export function LiveAgentCursor({ cursorRef, visible, phase, operation }: LiveAgentCursorProps) {
  const { zoom } = useViewport();
  const scale = zoom === 0 ? 1 : 1 / zoom;

  return (
    <ViewportPortal>
      <div
        ref={cursorRef}
        className={styles.cursor}
        {...(visible ? { "data-agent-cursor": "" } : {})}
        data-presence-phase={visible ? phase ?? undefined : undefined}
        data-presence-operation={visible ? operation ?? undefined : undefined}
        aria-hidden="true"
        data-visible={visible ? "true" : "false"}
      >
        <span className={styles.glyph} style={{ transform: `scale(${scale})` }}>
          <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
            <path
              fill="currentColor"
              d="M3.8 2.2 14.4 9.4c.4.3.2.9-.3.9H9.2L6.4 15.3c-.2.4-.8.3-.9-.1L3.1 3c-.1-.5.3-.9.7-.8Z"
            />
          </svg>
        </span>
      </div>
    </ViewportPortal>
  );
}
