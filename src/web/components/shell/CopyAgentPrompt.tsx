import { CopyButton } from "../primitives";

/** A context-neutral instruction a developer's coding agent can use to map a workflow. */
export const AGENT_PROMPT =
  "Read .codehq/SKILL.md and map the main product workflow.";

export const AGENT_PROMPT_EXAMPLES = [
  "Read .codehq/SKILL.md and map the purchase workflow.",
  "Read .codehq/SKILL.md and map the user journey from sign-in to download.",
] as const;

export function CopyAgentPrompt() {
  return <CopyButton value={AGENT_PROMPT} label="Copy agent prompt" />;
}
