import { copyToClipboard } from "../primitives/clipboard";
import { AGENT_PROMPT } from "../../lib/agentPrompt";

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
export function buildPaletteActions(
  onRecheck: () => Promise<void>,
  onResetLayout?: () => void,
  onOpenAgentPrompt?: () => void,
): PaletteAction[] {
  const actions: PaletteAction[] = [
    {
      id: "action:copy-prompt",
      label: onOpenAgentPrompt === undefined ? "Copy agent prompt" : "Refine workflow with agent",
      detail: onOpenAgentPrompt === undefined
        ? "Copies an instruction for your coding agent."
        : "Opens a prompt for the selected workflow.",
      run: async () => {
        if (onOpenAgentPrompt === undefined) {
          await copyToClipboard(AGENT_PROMPT);
        } else {
          onOpenAgentPrompt();
        }
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
