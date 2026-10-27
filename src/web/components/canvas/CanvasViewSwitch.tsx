import type { ReactElement } from "react";
import { ArrowUDownLeft, DotsThree, TreeView } from "@phosphor-icons/react";
import { Tooltip } from "../primitives";
import type { CanvasView } from "./layout";
import styles from "./CanvasViewSwitch.module.css";

const VIEWS: Array<{ view: CanvasView; label: string; hint: string; icon: ReactElement }> = [
  { view: "flow", label: "Flow", hint: "Flow: top to bottom, branches side by side", icon: <TreeView size={16} /> },
  { view: "wrap", label: "Wrap", hint: "Wrap: rows that read left to right", icon: <ArrowUDownLeft size={16} /> },
  { view: "line", label: "Line", hint: "Line: one long row", icon: <DotsThree size={16} weight="bold" /> },
];

export interface CanvasViewSwitchProps {
  view: CanvasView;
  /** The view the map's shape suggests; it carries a small dot. */
  autoView: CanvasView;
  onViewChange: (view: CanvasView) => void;
}

/** Flow, Wrap or Line: three pressed-state buttons in one inset group. */
export function CanvasViewSwitch({ view, autoView, onViewChange }: CanvasViewSwitchProps) {
  return (
    <div className={styles.group} role="group" aria-label="Canvas view">
      {VIEWS.map((item) => (
        <Tooltip key={item.view} content={item.view === autoView ? `${item.hint} (suggested for this map)` : item.hint}>
          <button
            type="button"
            className={styles.option}
            aria-label={`${item.label} view`}
            aria-pressed={item.view === view}
            data-suggested={item.view === autoView ? "true" : undefined}
            onClick={() => onViewChange(item.view)}
          >
            {item.icon}
          </button>
        </Tooltip>
      ))}
    </div>
  );
}
