/**
 * A minimal accessible disclosure menu: a trigger button plus a `role="menu"` list, closed on
 * Escape or an outside click. Exists because moving a workflow into a folder must work without
 * a pointer (contract §11 forbids drag-only interactions), so drag-and-drop needs a keyboard
 * fallback for every action it exposes.
 */
import { DotsThreeVertical } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { IconButton } from "../primitives";
import styles from "./ActionsMenu.module.css";

export interface ActionsMenuItem {
  label: string;
  onSelect: () => void;
}

export interface ActionsMenuProps {
  label: string;
  items: ActionsMenuItem[];
}

export function ActionsMenu({ label, items }: ActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handlePointerDown = (event: MouseEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.root} ref={rootRef}>
      <IconButton
        label={label}
        icon={<DotsThreeVertical size={16} weight="bold" aria-hidden="true" />}
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      />
      {open ? (
        <ul className={styles.menu} role="menu" aria-label={label}>
          {items.map((item) => (
            <li key={item.label} role="none">
              <button
                type="button"
                role="menuitem"
                className={styles.menuItem}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
