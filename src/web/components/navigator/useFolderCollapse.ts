/**
 * Per-folder collapse/expand state for the navigator, persisted across reloads. Deliberately
 * separate from `useCodeHQStore` (which only persists `theme`) — this is narrow, self-contained
 * UI state with no reason to grow the global store's persisted schema.
 */
import { useCallback, useState } from "react";

const STORAGE_KEY = "codehq.navigator.collapsedFolderIds";

function readStoredIds(): Record<string, true> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw !== null ? (JSON.parse(raw) as Record<string, true>) : {};
  } catch {
    return {};
  }
}

function writeStoredIds(ids: Record<string, true>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Storage unavailable or full: collapse state simply won't survive a reload this session.
  }
}

export interface UseFolderCollapseResult {
  collapsedIds: Record<string, true>;
  toggle: (folderId: string) => void;
}

export function useFolderCollapse(): UseFolderCollapseResult {
  const [collapsedIds, setCollapsedIds] = useState<Record<string, true>>(() => readStoredIds());

  const toggle = useCallback((folderId: string) => {
    setCollapsedIds((current) => {
      const next = { ...current };
      if (next[folderId]) {
        delete next[folderId];
      } else {
        next[folderId] = true;
      }
      writeStoredIds(next);
      return next;
    });
  }, []);

  return { collapsedIds, toggle };
}
