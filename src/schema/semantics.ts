import type { Issue } from "./diagnostics";
import type { Workflow } from "./workflow";

/**
 * Pure, isomorphic semantic validation for an already shape-valid `Workflow`.
 * Every function here returns `Issue[]` and never throws — see contract §5.
 */

const MAX_RECOMMENDED_STEPS = 14;

/** Visual/layout keys banned anywhere in workflow files — HQFlow owns rendering. */
export const VISUAL_KEYS = new Set([
  "x",
  "y",
  "position",
  "color",
  "colour",
  "style",
  "width",
  "height",
  "font",
  "css",
  "layout",
  "icon",
]);

export const VISUAL_PROPERTY_MESSAGE =
  "Visual properties are owned by HQFlow and must not appear in workflow files.";

/**
 * Formats a Zod-style path array as `connections[3].to`, not Zod's raw array form.
 * Zod types path segments as `PropertyKey` (JSON paths never actually contain symbols);
 * any symbol is stringified defensively so this never throws.
 */
export function formatIssuePath(path: ReadonlyArray<PropertyKey>): string {
  let result = "";
  for (const segment of path) {
    if (typeof segment === "number") {
      result += `[${segment}]`;
    } else {
      const key = String(segment);
      result += result.length > 0 ? `.${key}` : key;
    }
  }
  return result;
}

/** Rule 1 — step ids unique within a workflow. */
function checkUniqueStepIds(workflow: Workflow, file: string): Issue[] {
  const issues: Issue[] = [];
  const firstIndexById = new Map<string, number>();
  workflow.steps.forEach((step, index) => {
    const firstIndex = firstIndexById.get(step.id);
    if (firstIndex === undefined) {
      firstIndexById.set(step.id, index);
      return;
    }
    issues.push({
      severity: "error",
      file,
      path: `steps[${index}].id`,
      message: `Duplicate step id '${step.id}'. Step ids must be unique within a workflow.`,
      hint: `Rename this step to a unique id, or remove the duplicate of 'steps[${firstIndex}]'.`,
    });
  });
  return issues;
}

/** Rule 2 — every connection.from / connection.to references an existing step id. */
function checkConnectionReferences(workflow: Workflow, file: string): Issue[] {
  const stepIds = new Set(workflow.steps.map((step) => step.id));
  const issues: Issue[] = [];
  workflow.connections.forEach((connection, index) => {
    (["from", "to"] as const).forEach((key) => {
      const referencedId = connection[key];
      if (!stepIds.has(referencedId)) {
        issues.push({
          severity: "error",
          file,
          path: `connections[${index}].${key}`,
          message: `Connection references missing step '${referencedId}'.`,
          hint: `Add a step with id '${referencedId}', or point this connection at an existing step.`,
        });
      }
    });
  });
  return issues;
}

function computeEntryStepIds(workflow: Workflow): Set<string> {
  const categorizedEntries = workflow.steps.filter((step) => step.category === "entry").map((step) => step.id);
  if (categorizedEntries.length > 0) {
    return new Set(categorizedEntries);
  }

  const stepsWithIncoming = new Set(workflow.connections.map((connection) => connection.to));
  const zeroIndegreeSteps = workflow.steps.filter((step) => !stepsWithIncoming.has(step.id)).map((step) => step.id);
  if (zeroIndegreeSteps.length > 0) {
    return new Set(zeroIndegreeSteps);
  }

  const firstStep = workflow.steps[0];
  return firstStep ? new Set([firstStep.id]) : new Set();
}

/**
 * Warn (not error) on a step unreachable from any entry step, and on a workflow
 * with more than 14 steps. "Entry" steps are those categorized `entry`; if none are
 * categorized, steps with no incoming connection are treated as entries instead.
 */
function checkReachabilityAndSize(workflow: Workflow, file: string): Issue[] {
  const issues: Issue[] = [];
  const entryStepIds = computeEntryStepIds(workflow);

  const adjacency = new Map<string, string[]>();
  for (const connection of workflow.connections) {
    const targets = adjacency.get(connection.from) ?? [];
    targets.push(connection.to);
    adjacency.set(connection.from, targets);
  }

  const reached = new Set<string>();
  const queue: string[] = [...entryStepIds];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || reached.has(current)) {
      continue;
    }
    reached.add(current);
    for (const next of adjacency.get(current) ?? []) {
      if (!reached.has(next)) {
        queue.push(next);
      }
    }
  }

  workflow.steps.forEach((step, index) => {
    if (!reached.has(step.id)) {
      issues.push({
        severity: "warning",
        file,
        path: `steps[${index}].id`,
        message: `Step '${step.id}' is unreachable from any entry step.`,
        hint: "Connect this step from an entry step, mark it category \"entry\", or remove it if it is unused.",
      });
    }
  });

  if (workflow.steps.length > MAX_RECOMMENDED_STEPS) {
    issues.push({
      severity: "warning",
      file,
      path: "steps",
      message: `Workflow has ${workflow.steps.length} steps, which is more than the recommended maximum of ${MAX_RECOMMENDED_STEPS}.`,
      hint: "Prefer 5-9 top-level steps; group related steps or split this into multiple workflows.",
    });
  }

  return issues;
}

/** Warn (not error) on a duplicate connection (same from/to/type). */
function checkDuplicateConnections(workflow: Workflow, file: string): Issue[] {
  const issues: Issue[] = [];
  const firstIndexByKey = new Map<string, number>();
  workflow.connections.forEach((connection, index) => {
    const key = `${connection.from}=>${connection.to}#${connection.type ?? "success"}`;
    const firstIndex = firstIndexByKey.get(key);
    if (firstIndex === undefined) {
      firstIndexByKey.set(key, index);
      return;
    }
    issues.push({
      severity: "warning",
      file,
      path: `connections[${index}]`,
      message: `Duplicate connection from '${connection.from}' to '${connection.to}' (type: ${connection.type ?? "success"}).`,
      hint: "Remove this duplicate, or differentiate it with a distinct 'condition' or 'type'.",
    });
  });
  return issues;
}

/** Runs relational and cross-object semantic rules over an already shape-valid `workflow`. */
export function validateWorkflowSemantics(workflow: Workflow, file: string): Issue[] {
  return [
    ...checkUniqueStepIds(workflow, file),
    ...checkConnectionReferences(workflow, file),
    ...checkReachabilityAndSize(workflow, file),
    ...checkDuplicateConnections(workflow, file),
  ];
}
