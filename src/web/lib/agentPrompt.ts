import type { RepositoryWorkflow } from "@schema/repository-map";

/** The first-run prompt maps the overview first, then each workflow file. */
export const AGENT_PROMPT = `Read .codehq/SKILL.md and map this repository. Identify 5–9 primary user-facing or system workflows. Write .codehq/repository-map.json first, with evidence-backed handoffs, so HQFlow can show the overview immediately. Then map each workflow into its own .codehq/workflows/<id>.json file, saving complete, valid checkpoints as you work. Do not map low-level utilities as workflows. Run hqflow validate and fix all errors before handoff.`;

export const ANOTHER_WORKFLOW_PROMPT = "Read .codehq/SKILL.md. Identify one important workflow that is missing from .codehq/repository-map.json, add it with only evidence-backed handoffs, map its detail file under .codehq/workflows/, and run hqflow validate.";

export function workflowMappingPrompt(workflow: RepositoryWorkflow): string {
  const entryPoint = workflow.entryPoint === undefined
    ? "Find and verify its real entry point."
    : `Start from ${workflow.entryPoint.file}${workflow.entryPoint.symbol ? ` at ${workflow.entryPoint.symbol}` : ""}.`;
  return `Read .codehq/SKILL.md and map the ${workflow.name} workflow (${workflow.id}). ${entryPoint} Write only .codehq/workflows/${workflow.id}.json, save complete valid checkpoints, and run hqflow validate.`;
}
