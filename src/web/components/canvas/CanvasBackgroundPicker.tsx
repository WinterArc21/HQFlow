import { Check, Image as ImageIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { useCodeHQStore, type CanvasBackground } from "../../store/useCodeHQStore";
import { IconButton } from "../primitives";
import styles from "./CanvasBackgroundPicker.module.css";

const OPTIONS: ReadonlyArray<{
  id: CanvasBackground;
  label: string;
  description: string;
  swatchClass: string;
}> = [
  { id: "grid", label: "Graph paper", description: "Technical dot grid", swatchClass: styles.swatchGrid! },
  { id: "mist", label: "Mist forest", description: "Uploaded image", swatchClass: styles.swatchMist! },
  { id: "blueprint", label: "Blueprint", description: "Cool drafting lines", swatchClass: styles.swatchBlueprint! },
  { id: "plain", label: "Plain", description: "Quiet surface", swatchClass: styles.swatchPlain! },
];

/** Small, local-first background chooser for trying different canvas moods without changing the graph. */
export function CanvasBackgroundPicker() {
  const canvasBackground = useCodeHQStore((state) => state.canvasBackground);
  const setCanvasBackground = useCodeHQStore((state) => state.setCanvasBackground);
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const currentOption = OPTIONS.find((option) => option.id === canvasBackground) ?? OPTIONS[0]!;

  useEffect(() => {
    if (!open) {
      return;
    }

    const closeOnOutsidePointer = (event: PointerEvent): void => {
      if (pickerRef.current !== null && !pickerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className={styles.picker} ref={pickerRef}>
      <IconButton
        label={`Canvas background: ${currentOption.label}`}
        icon={<ImageIcon size={16} />}
        size="sm"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((isOpen) => !isOpen)}
      />
      {open ? (
        <div className={styles.menu} role="menu" aria-label="Canvas background options">
          <div className={styles.heading}>
            <span>Canvas background</span>
            <span className={styles.headingHint}>Saved locally</span>
          </div>
          {OPTIONS.map((option) => (
            <button
              type="button"
              role="menuitemradio"
              aria-checked={canvasBackground === option.id}
              className={`${styles.option} ${canvasBackground === option.id ? styles.selected : ""}`}
              key={option.id}
              onClick={() => {
                setCanvasBackground(option.id);
                setOpen(false);
              }}
            >
              <span className={`${styles.swatch} ${option.swatchClass}`} aria-hidden="true" />
              <span className={styles.optionCopy}>
                <span className={styles.optionLabel}>{option.label}</span>
                <span className={styles.optionDescription}>{option.description}</span>
              </span>
              {canvasBackground === option.id ? <Check className={styles.check} size={15} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
