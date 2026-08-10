import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { MagnifyingGlass } from "@phosphor-icons/react";
import type { CodeHQSnapshot } from "../../api/types";
import { useCodeHQStore } from "../../store/useCodeHQStore";
import { useFocusTrap } from "../../lib/useFocusTrap";
import { useBackdropDismiss } from "../../lib/useBackdropDismiss";
import { Kbd } from "../primitives";
import { buildPaletteActions } from "./paletteActions";
import { buildPaletteGroups } from "./paletteGroups";
import type { SearchResult } from "./searchIndex";
import styles from "./CommandPalette.module.css";

export interface CommandPaletteProps {
  snapshot: CodeHQSnapshot | null;
  onRecheck: () => Promise<void>;
}

/**
 * Global search / command palette (contract §11). Always mounted so the Ctrl/Cmd+K shortcut
 * works regardless of whether the dialog is currently open; renders nothing until it is.
 */
export function CommandPalette({ snapshot, onRecheck }: CommandPaletteProps) {
  const searchOpen = useCodeHQStore((state) => state.searchOpen);
  const openSearch = useCodeHQStore((state) => state.openSearch);
  const closeSearch = useCodeHQStore((state) => state.closeSearch);
  const searchQuery = useCodeHQStore((state) => state.searchQuery);
  const setSearchQuery = useCodeHQStore((state) => state.setSearchQuery);
  const selectedWorkflowId = useCodeHQStore((state) => state.selectedWorkflowId);
  const selectWorkflow = useCodeHQStore((state) => state.selectWorkflow);
  const selectStep = useCodeHQStore((state) => state.selectStep);
  const selectStepAndPan = useCodeHQStore((state) => state.selectStepAndPan);
  const resetLayout = useCodeHQStore((state) => state.resetLayout);

  const containerRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const listboxId = useId();

  useFocusTrap(containerRef, searchOpen, closeSearch);
  const backdropDismiss = useBackdropDismiss(closeSearch);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      const isModified = event.metaKey || event.ctrlKey;
      if (!isModified || event.key.toLowerCase() !== "k") {
        return;
      }
      event.preventDefault();
      if (useCodeHQStore.getState().searchOpen) {
        closeSearch();
      } else {
        openSearch();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openSearch, closeSearch]);

  // Resets the highlighted row to the top whenever the query changes or the palette re-opens.
  // Adjusted during render — React's documented pattern for "state that depends on a changing
  // value" (https://react.dev/learn/you-might-not-need-an-effect) — rather than in an effect,
  // which would cause an extra, avoidable re-render. Refs are deliberately not used here: this
  // codebase's stricter react-hooks rules forbid reading/writing ref values during render.
  const resetKey = `${searchOpen}:${searchQuery}`;
  const [previousResetKey, setPreviousResetKey] = useState(resetKey);
  if (previousResetKey !== resetKey) {
    setPreviousResetKey(resetKey);
    if (activeIndex !== 0) {
      setActiveIndex(0);
    }
  }

  const handleActivateResult = useCallback(
    (result: SearchResult) => {
      selectWorkflow(result.workflowId);
      if (result.kind !== "workflow" && result.stepId !== undefined) {
        selectStepAndPan(result.workflowId, result.stepId);
      } else {
        selectStep(null);
      }
      closeSearch();
    },
    [selectWorkflow, selectStep, selectStepAndPan, closeSearch],
  );

  const handleResetLayout = useCallback(() => {
    resetLayout();
    closeSearch();
  }, [closeSearch, resetLayout]);

  if (!searchOpen) {
    return null;
  }

  const canResetLayout = selectedWorkflowId !== null && snapshot?.workflows.some((record) => record.id === selectedWorkflowId) === true;
  const actions = buildPaletteActions(onRecheck, canResetLayout ? handleResetLayout : undefined);
  const groups = snapshot !== null ? buildPaletteGroups(searchQuery, snapshot, actions, handleActivateResult) : [];

  let cursor = 0;
  const indexedGroups = groups.map((group) => ({
    ...group,
    rows: group.rows.map((row) => ({ ...row, index: cursor++ })),
  }));
  const totalRows = cursor;
  const activeRowIndex = totalRows === 0 ? -1 : Math.min(activeIndex, totalRows - 1);
  const activeOptionId = activeRowIndex >= 0 ? `${listboxId}-option-${activeRowIndex}` : undefined;

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => Math.min(current + 1, Math.max(totalRows - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const row = indexedGroups.flatMap((group) => group.rows).find((candidate) => candidate.index === activeRowIndex);
      row?.onActivate();
    }
  };

  return (
    <div className={styles.backdrop} {...backdropDismiss}>
      <div ref={containerRef} className={styles.palette} role="dialog" aria-modal="true" aria-label="Search HQFlow">
        <div className={styles.inputRow}>
          <MagnifyingGlass size={16} aria-hidden="true" />
          <input
            className={styles.input}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listboxId}
            aria-autocomplete="list"
            {...(activeOptionId !== undefined ? { "aria-activedescendant": activeOptionId } : {})}
            placeholder="Search workflows, steps, files, edge cases, tests…"
            autoFocus
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={handleInputKeyDown}
          />
          <Kbd>Esc</Kbd>
        </div>
        <div className={styles.results} id={listboxId} role="listbox" aria-label="Search results">
          {snapshot === null ? (
            <p className={styles.empty}>Search is not available until the workspace finishes loading.</p>
          ) : totalRows === 0 ? (
            <p className={styles.empty} role="status">
              No results for &ldquo;{searchQuery.trim()}&rdquo;.
            </p>
          ) : (
            indexedGroups.map((group) => (
              <div key={group.key} role="presentation">
                <div className={styles.groupLabel} role="presentation">
                  {group.label}
                </div>
                {group.rows.map((row) => (
                  <div
                    key={row.id}
                    id={`${listboxId}-option-${row.index}`}
                    role="option"
                    aria-selected={row.index === activeRowIndex}
                    className={`${styles.option} ${row.index === activeRowIndex ? styles.active : ""}`}
                    onMouseEnter={() => setActiveIndex(row.index)}
                    onClick={row.onActivate}
                  >
                    <span className={styles.optionLabel}>{row.label}</span>
                    {row.detail !== undefined ? <span className={styles.optionDetail}>{row.detail}</span> : null}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
