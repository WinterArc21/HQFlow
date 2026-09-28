import type { RepositoryWorkflow } from "@schema/repository-map";
import type { WorkflowRecord } from "../api/types";

/** The first-run prompt maps the overview first, then delegates independent workflow files. */
export const AGENT_PROMPT = `Read .codehq/SKILL.md and map this repository. Identify 5–9 primary user-facing or system workflows. Write .codehq/repository-map.json first, with evidence-backed handoffs, so HQFlow can show the overview immediately. Then, when subagents are available, assign each workflow to a separate subagent and map them concurrently. Each subagent must own exactly one .codehq/workflows/<id>.json file and save complete, valid checkpoints as it works. If subagents are unavailable, map the files sequentially. Do not map low-level utilities as workflows. Run hqflow validate and fix all errors before handoff.`;

export const ANOTHER_WORKFLOW_PROMPT = "Read .codehq/SKILL.md. Identify one important workflow that is missing from .codehq/repository-map.json, add it with only evidence-backed handoffs, map its detail file under .codehq/workflows/, and run hqflow validate.";

export function workflowMappingPrompt(workflow: RepositoryWorkflow): string {
  const entryPoint = workflow.entryPoint === undefined
    ? "Find and verify its real entry point."
    : `Start from ${workflow.entryPoint.file}${workflow.entryPoint.symbol ? ` at ${workflow.entryPoint.symbol}` : ""}.`;
  return `Read .codehq/SKILL.md and map the ${workflow.name} workflow (${workflow.id}). ${entryPoint} Write only .codehq/workflows/${workflow.id}.json, save complete valid checkpoints, and run hqflow validate.`;
}

/**
 * Asks the agent to re-check exactly the steps whose referenced code changed since the workflow
 * was written. Rewriting the file records a fresh baseline, which clears the flags.
 */
export function recheckOutdatedStepsPrompt(record: WorkflowRecord): string {
  const outdated = record.freshness?.outdatedSteps ?? {};
  const lines = record.workflow.steps
    .filter((step) => outdated[step.id] !== undefined)
    .map((step) => {
      const changes = (outdated[step.id] ?? [])
        .map((changed) => `${changed.file} ${changed.change === "deleted" ? "was deleted" : "changed"}`)
        .join(", ");
      return `- ${step.name} (${step.id}): ${changes}`;
    });
  return [
    `Read .codehq/SKILL.md. Code changed after ${record.file} was written. Re-check these steps against the current code:`,
    ...lines,
    `Update ${record.file} wherever it no longer matches the code, keep existing step ids, and run hqflow validate.`,
  ].join("\n");
}
