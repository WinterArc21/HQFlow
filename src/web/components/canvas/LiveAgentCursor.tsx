import { Cursor } from "@phosphor-icons/react";
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

/** One screen-sized agent cursor in flow space. It follows pan and zoom through ViewportPortal. */
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
          <Cursor size={18} weight="fill" />
        </span>
      </div>
    </ViewportPortal>
  );
}
