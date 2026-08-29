/** A context-neutral instruction a developer's coding agent can use to map a workflow. */
export const AGENT_PROMPT = "Read .codehq/SKILL.md and map the main product workflow.";

/** Stable agent-facing identity derived from the schema-validated workflow ID. */
export function workflowMention(workflowId: string): string {
  return `@${workflowId}`;
}

/** Exact repository-relative file owned by a mapped workflow. */
export function workflowFilePath(workflowId: string): string {
  return `.codehq/workflows/${workflowId}.json`;
}

/**
 * Adds portable workflow context around the user's request. The request is not normalized so
 * punctuation, spacing, and any other edits reach the external agent exactly as written.
 */
export function composeWorkflowAgentPrompt(workflowId: string, request: string): string {
  return [
    "Read .codehq/SKILL.md and update the mapped workflow identified below.",
    "",
    `Workflow: ${workflowMention(workflowId)}`,
    `File: ${workflowFilePath(workflowId)}`,
    "",
    "Request:",
    request,
  ].join("\n");
}
