import type { CodeHQSnapshot } from "../../api/types";
import type { PaletteAction } from "./paletteActions";
import { defaultResults, groupResults, search, type SearchResult } from "./searchIndex";

export interface PaletteRow {
  id: string;
  label: string;
  detail?: string;
  onActivate: () => void;
}

export interface PaletteGroup {
  key: string;
  label: string;
  rows: PaletteRow[];
}

function resultToRow(result: SearchResult, onActivate: (result: SearchResult) => void): PaletteRow {
  return {
    id: result.id,
    label: result.title,
    ...(result.subtitle !== undefined ? { detail: result.subtitle } : {}),
    onActivate: () => onActivate(result),
  };
}

/**
 * Combines the pure search ranking with the palette's UI-only concerns (default actions,
 * count-annotated group labels) into a single ordered list of groups for the command palette to
 * render and keyboard-navigate over.
 */
export function buildPaletteGroups(
  query: string,
  snapshot: CodeHQSnapshot,
  actions: PaletteAction[],
  onActivateResult: (result: SearchResult) => void,
): PaletteGroup[] {
  const trimmed = query.trim();

  if (trimmed.length === 0) {
    const workflowRows = defaultResults(snapshot).map((result) => resultToRow(result, onActivateResult));
    const groups: PaletteGroup[] = [];
    if (workflowRows.length > 0) {
      groups.push({ key: "workflow", label: "Workflows", rows: workflowRows });
    }
    groups.push({
      key: "actions",
      label: "Actions",
      rows: actions.map((action) => ({
        id: action.id,
        label: action.label,
        detail: action.detail,
        onActivate: () => void action.run(),
      })),
    });
    return groups;
  }

  const groups: PaletteGroup[] = groupResults(search(snapshot, trimmed)).map((group) => ({
    key: group.kind,
    label: `${group.label} (${group.items.length})`,
    rows: group.items.map((result) => resultToRow(result, onActivateResult)),
  }));
  const normalizedQuery = trimmed.toLocaleLowerCase();
  const matchingActions = actions.filter((action) =>
    `${action.label} ${action.detail}`.toLocaleLowerCase().includes(normalizedQuery),
  );
  if (matchingActions.length > 0) {
    groups.push({
      key: "actions",
      label: `Actions (${matchingActions.length})`,
      rows: matchingActions.map((action) => ({
        id: action.id,
        label: action.label,
        detail: action.detail,
        onActivate: () => void action.run(),
      })),
    });
  }
  return groups;
}
