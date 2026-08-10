import { copyToClipboard } from "../primitives/clipboard";
import { AGENT_PROMPT } from "../shell/CopyAgentPrompt";

export interface PaletteAction {
  id: string;
  label: string;
  detail: string;
  run: () => Promise<void>;
}

/**
 * The two-or-three "most useful actions" shown alongside the workflow list on an empty query
 * (contract). Each wires to the exact same API functions the rest of the app already uses —
 * nothing here is a placeholder.
 */
export function buildPaletteActions(onRecheck: () => Promise<void>, onResetLayout?: () => void): PaletteAction[] {
  const actions: PaletteAction[] = [
    {
      id: "action:copy-prompt",
      label: "Copy agent prompt",
      detail: "Copies an instruction for your coding agent.",
      run: async () => {
        await copyToClipboard(AGENT_PROMPT);
      },
    },
    {
      id: "action:recheck",
      label: "Recheck files",
      detail: "Forces a full reload of every workflow file on disk.",
      run: onRecheck,
    },
  ];
  if (onResetLayout !== undefined) {
    actions.push({
      id: "action:reset-layout",
      label: "Reset layout",
      detail: "Restores dragged nodes to their generated positions.",
      run: async () => {
        onResetLayout();
      },
    });
  }
  return actions;
}
