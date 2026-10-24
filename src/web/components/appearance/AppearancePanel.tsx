import { useEffect, useRef, type CSSProperties } from "react";
import { X } from "@phosphor-icons/react";
import { SCENES } from "../../design/scenes";
import { useCodeHQStore, type MotionLevel } from "../../store/useCodeHQStore";
import { activeScene } from "../backdrop";
import { IconButton } from "../primitives";
import { Island } from "../shell/Island";
import { useDotGrid } from "../shell/dotGrid";
import styles from "./AppearancePanel.module.css";

const PANEL_WIDTH = 14;
const PANEL_TOP = 3;

interface Choice<T extends string> {
  value: T;
  label: string;
}

const MOTION_CHOICES: Choice<MotionLevel>[] = [
  { value: "full", label: "Full" },
  { value: "calm", label: "Calm" },
  { value: "still", label: "Still" },
];
function Segmented<T extends string>({ label, value, choices, onChange }: { label: string; value: T; choices: Choice<T>[]; onChange: (value: T) => void }) {
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel} id={`appearance-${label}`}>{label}</span>
      <div className={styles.segmented} role="radiogroup" aria-labelledby={`appearance-${label}`}>
        {choices.map((choice) => (
          <button
            key={choice.value}
            type="button"
            role="radio"
            aria-checked={value === choice.value}
            className={styles.segment}
            onClick={() => onChange(choice.value)}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Appearance: pick a scene and how much it moves. Grid, card surface, and card colours
 * belong to the scene. Everything persists locally; nothing reaches the workflow files.
 */
export function AppearancePanel({ onClose }: { onClose: () => void }) {
  const grid = useDotGrid();
  const panelRef = useRef<HTMLDivElement>(null);
  const scene = useCodeHQStore(activeScene);
  const theme = useCodeHQStore((state) => state.theme);
  const motion = useCodeHQStore((state) => state.motion);
  const setScene = useCodeHQStore((state) => state.setScene);
  const setMotion = useCodeHQStore((state) => state.setMotion);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element;
      if (!panelRef.current?.contains(target) && target.closest("[data-appearance-toggle]") === null) {
        onClose();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const width = Math.min(PANEL_WIDTH, grid.lastColumn);

  return (
    <Island
      ref={panelRef}
      placement={{ r: 0, t: PANEL_TOP, w: width, h: "auto" }}
      maxHeight={Math.max(4, grid.lastRow - PANEL_TOP)}
      className={styles.panel}
      role="dialog"
      aria-label="Appearance"
    >
      <div className={styles.body}>
        <div className={styles.header}>
          <h2 className={styles.title}>Appearance</h2>
          <IconButton label="Close appearance" icon={<X size={14} />} size="sm" onClick={onClose} />
        </div>

        <section aria-label="Scene">
          <span className={styles.sectionLabel}>Scene</span>
          <div className={styles.scenes} role="radiogroup" aria-label="Scene">
            {SCENES.map((option, index) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={option.id === scene.id}
                className={styles.scene}
                style={{ "--i": index } as CSSProperties}
                title={option.tagline}
                data-scene-shader={option.shader !== null ? "" : undefined}
                onClick={() => setScene(option.id, option.base === "both" ? theme : option.base)}
              >
                <span className={styles.swatch} data-scene-probe={option.id} aria-hidden="true">
                  <span className={styles.chip} />
                  <span className={styles.chip} />
                  <span className={styles.chip} />
                </span>
                <span className={styles.sceneName}>{option.name}</span>
              </button>
            ))}
          </div>
          <p className={styles.tagline}>{scene.tagline}</p>
        </section>

        <Segmented label="Motion" value={motion} choices={MOTION_CHOICES} onChange={setMotion} />

      </div>
    </Island>
  );
}
