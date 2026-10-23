import { useEffect, useRef, type CSSProperties } from "react";
import { ArrowCounterClockwise, Shuffle, X } from "@phosphor-icons/react";
import { CATEGORY_KEYS, SCENES, type CategoryKey } from "../../design/scenes";
import { categoryToken } from "../../design/semantics";
import { useCodeHQStore, type CardSurface, type GridMode, type MotionLevel } from "../../store/useCodeHQStore";
import { activeScene, readCssColor, toHexColor } from "../backdrop";
import { IconButton } from "../primitives";
import { Island } from "../shell/Island";
import { useDotGrid } from "../shell/dotGrid";
import { shuffledPalette } from "./palette";
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
const GRID_CHOICES: Choice<GridMode>[] = [
  { value: "scene", label: "Scene" },
  { value: "dots", label: "Dots" },
  { value: "none", label: "None" },
];
const CARD_CHOICES: Choice<CardSurface>[] = [
  { value: "scene", label: "Scene" },
  { value: "solid", label: "Solid" },
  { value: "glass", label: "Glass" },
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
 * Appearance: pick a scene, tune motion, grid and card surface, and recolour each card category
 * for the scene you are on. Everything persists locally; nothing reaches the workflow files.
 */
export function AppearancePanel({ onClose }: { onClose: () => void }) {
  const grid = useDotGrid();
  const panelRef = useRef<HTMLDivElement>(null);
  const scene = useCodeHQStore(activeScene);
  const motion = useCodeHQStore((state) => state.motion);
  const gridMode = useCodeHQStore((state) => state.gridMode);
  const cardSurface = useCodeHQStore((state) => state.cardSurface);
  const overrides = useCodeHQStore((state) => state.categoryColors[scene.id]);
  const setScene = useCodeHQStore((state) => state.setScene);
  const setMotion = useCodeHQStore((state) => state.setMotion);
  const setGridMode = useCodeHQStore((state) => state.setGridMode);
  const setCardSurface = useCodeHQStore((state) => state.setCardSurface);
  const setCategoryColors = useCodeHQStore((state) => state.setCategoryColors);

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

  // `applyAppearance` has already written this scene onto the document, so the computed
  // `--cat-*` values here are the colours on screen.
  const colors = Object.fromEntries(
    CATEGORY_KEYS.map((key) => [key, overrides?.[key] ?? toHexColor(readCssColor(`var(--cat-${key})`))]),
  ) as Record<CategoryKey, string>;
  const setColor = (key: CategoryKey, color: string) => {
    // Entry and output are the two ends of one workflow and share a colour (semantics.ts).
    const linked = key === "entry" || key === "output" ? { entry: color, output: color } : { [key]: color };
    setCategoryColors(scene.id, { ...overrides, ...linked });
  };
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
                data-scene-shader={option.shader !== null ? "" : undefined}
                style={{ "--i": index } as CSSProperties}
                title={option.tagline}
                onClick={() => setScene(option.id, option.base)}
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
        <Segmented label="Grid" value={gridMode} choices={GRID_CHOICES} onChange={setGridMode} />
        <Segmented label="Cards" value={cardSurface} choices={CARD_CHOICES} onChange={setCardSurface} />

        <section aria-label="Card colours">
          <div className={styles.sectionHeader}>
            <span className={styles.sectionLabel}>Card colours · {scene.name}</span>
            <IconButton
              label="Shuffle card colours"
              icon={<Shuffle size={14} />}
              size="sm"
              onClick={() => setCategoryColors(scene.id, shuffledPalette(scene.base))}
            />
            <IconButton
              label="Reset card colours"
              icon={<ArrowCounterClockwise size={14} />}
              size="sm"
              disabled={overrides === undefined}
              onClick={() => setCategoryColors(scene.id, null)}
            />
          </div>
          <div className={styles.colors}>
            {CATEGORY_KEYS.map((key) => (
              <label key={key} className={styles.color} style={{ "--swatch": colors[key] } as CSSProperties}>
                <input
                  type="color"
                  className={styles.colorInput}
                  value={colors[key]}
                  onChange={(event) => setColor(key, event.target.value)}
                />
                <span className={styles.colorDot} aria-hidden="true" />
                <span className={styles.colorLabel}>{categoryToken(key).label}</span>
              </label>
            ))}
          </div>
        </section>
      </div>
    </Island>
  );
}
