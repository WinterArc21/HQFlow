import type { ZodError } from "zod";
import type { Issue } from "./diagnostics";
import { behaviorSchema, transitionId, type Behavior } from "./behavior";
import { codeHQProjectSchema, type CodeHQProject } from "./project";
import { repositoryMapSchema, type RepositoryMap } from "./repository-map";
import { formatIssuePath, validateWorkflowSemantics, VISUAL_KEYS, VISUAL_PROPERTY_MESSAGE } from "./semantics";
import { workflowSchema, type Workflow } from "./workflow";

type ZodIssue = ZodError["issues"][number];

function ensureSentence(message: string): string {
  const trimmed = message.trim();
  if (trimmed.length === 0) {
    return trimmed;
  }
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function hintForZodIssue(issue: ZodIssue): string | undefined {
  switch (issue.code) {
    case "invalid_type":
      return "Check that this field is present and has the correct type.";
    case "invalid_value":
      return "Use one of the allowed values.";
    case "too_small":
      return "Provide more items, or a longer value.";
    case "too_big":
      return "Provide fewer items, or a shorter value.";
    case "invalid_format":
      return "Check that the value matches the expected format.";
    default:
      return undefined;
  }
}

/**
 * Converts a ZodError into the contract's `Issue[]` shape: a readable dotted/bracketed
 * `path` (e.g. `connections[3].to`, never Zod's raw path array), and a complete-sentence
 * `message`. Unknown keys that are banned visual/layout properties get the exact
 * contract-mandated message instead of a generic "unrecognized key" message.
 */
export function zodErrorToIssues(error: ZodError, file: string): Issue[] {
  const issues: Issue[] = [];

  for (const zodIssue of error.issues) {
    const basePath = formatIssuePath(zodIssue.path);

    if (zodIssue.code === "unrecognized_keys") {
      for (const key of zodIssue.keys) {
        const keyPath = basePath.length > 0 ? `${basePath}.${key}` : key;
        if (VISUAL_KEYS.has(key)) {
          issues.push({
            severity: "error",
            file,
            path: keyPath,
            message: VISUAL_PROPERTY_MESSAGE,
            hint: "Remove this property. HQFlow computes layout, color, and styling automatically.",
          });
        } else {
          issues.push({
            severity: "error",
            file,
            path: keyPath,
            message: `Unrecognized property '${key}' is not part of the schema.`,
            hint: "Remove it, or check for a typo against the documented fields.",
          });
        }
      }
      continue;
    }

    const hint = hintForZodIssue(zodIssue);
    issues.push({
      severity: "error",
      file,
      ...(basePath.length > 0 ? { path: basePath } : {}),
      message: ensureSentence(zodIssue.message),
      ...(hint !== undefined ? { hint } : {}),
    });
  }

  return issues;
}

export type ParseProjectResult =
  | { ok: true; value: CodeHQProject }
  | { ok: false; issues: Issue[] };

/** Parses and shape-validates an `.codehq/project.json` payload. */
export function parseProject(data: unknown, file: string): ParseProjectResult {
  const result = codeHQProjectSchema.safeParse(data);
  if (!result.success) {
    return { ok: false, issues: zodErrorToIssues(result.error, file) };
  }
  return { ok: true, value: result.data };
}

export type ParseRepositoryMapResult =
  | { ok: true; value: RepositoryMap; warnings: Issue[] }
  | { ok: false; issues: Issue[] };

/** Parses the repository overview and verifies that all handoffs reference declared workflows. */
export function parseRepositoryMap(data: unknown, file: string): ParseRepositoryMapResult {
  const result = repositoryMapSchema.safeParse(data);
  if (!result.success) {
    return { ok: false, issues: zodErrorToIssues(result.error, file) };
  }

  const issues: Issue[] = [];
  const firstIndexById = new Map<string, number>();
  result.data.workflows.forEach((workflow, index) => {
    const firstIndex = firstIndexById.get(workflow.id);
    if (firstIndex !== undefined) {
      issues.push({
        severity: "error",
        file,
        path: `workflows[${index}].id`,
        message: `Duplicate repository workflow id '${workflow.id}'.`,
        hint: `Remove this duplicate of 'workflows[${firstIndex}]'.`,
      });
    } else {
      firstIndexById.set(workflow.id, index);
    }
  });

  const ids = new Set(result.data.workflows.map((workflow) => workflow.id));
  result.data.connections.forEach((connection, index) => {
    (["from", "to"] as const).forEach((key) => {
      if (!ids.has(connection[key])) {
        issues.push({
          severity: "error",
          file,
          path: `connections[${index}].${key}`,
          message: `Repository connection references missing workflow '${connection[key]}'.`,
          hint: "Add that workflow to repository-map.json, or correct the connection.",
        });
      }
    });
  });

  return issues.some((issue) => issue.severity === "error")
    ? { ok: false, issues }
    : { ok: true, value: result.data, warnings: issues };
}

export type ParseWorkflowResult =
  | { ok: true; value: Workflow; warnings: Issue[] }
  | { ok: false; issues: Issue[] };

/**
 * Parses, shape-validates, and semantically validates an `.codehq/workflows/<id>.json`
 * payload. Shape errors (from Zod) short-circuit before semantic rules run. When shape
 * validation passes but a semantic rule reports an `error`, the whole workflow is invalid
 * (`ok: false`) and `issues` contains every semantic finding, errors and warnings alike, so
 * diagnostics can show the complete picture at once.
 */
export function parseWorkflow(data: unknown, file: string): ParseWorkflowResult {
  const shapeResult = workflowSchema.safeParse(data);
  if (!shapeResult.success) {
    return { ok: false, issues: zodErrorToIssues(shapeResult.error, file) };
  }

  const semanticIssues = validateWorkflowSemantics(shapeResult.data, file);
  const hasErrors = semanticIssues.some((issue) => issue.severity === "error");
  if (hasErrors) {
    return { ok: false, issues: semanticIssues };
  }

  return { ok: true, value: shapeResult.data, warnings: semanticIssues };
}

const MAX_RECOMMENDED_MOMENTS = 14;

function duplicateIdIssues(ids: ReadonlyArray<string | undefined>, file: string, field: string, label: string): Issue[] {
  const issues: Issue[] = [];
  const firstIndexById = new Map<string, number>();
  ids.forEach((id, index) => {
    if (id === undefined) return;
    const firstIndex = firstIndexById.get(id);
    if (firstIndex === undefined) {
      firstIndexById.set(id, index);
      return;
    }
    issues.push({
      severity: "error",
      file,
      path: `${field}[${index}].id`,
      message: `Duplicate ${label} id '${id}'.`,
      hint: `Rename it, or remove this duplicate of '${field}[${firstIndex}]'.`,
    });
  });
  return issues;
}

function unreachableMomentIssues(behavior: Behavior, file: string): Issue[] {
  const starts = behavior.moments.filter((moment) => moment.kind === "start").map((moment) => moment.id);
  if (starts.length === 0) {
    return [{
      severity: "warning",
      file,
      path: "moments",
      message: "No moment has kind \"start\".",
      hint: "Mark the moment where the user's journey begins with kind \"start\".",
    }];
  }
  const next = new Map<string, string[]>();
  for (const transition of behavior.transitions) {
    next.set(transition.from, [...(next.get(transition.from) ?? []), transition.to]);
  }
  const reached = new Set<string>();
  const queue = [...starts];
  for (let current = queue.shift(); current !== undefined; current = queue.shift()) {
    if (reached.has(current)) continue;
    reached.add(current);
    queue.push(...(next.get(current) ?? []));
  }
  return behavior.moments.flatMap((moment, index) => reached.has(moment.id) ? [] : [{
    severity: "warning" as const,
    file,
    path: `moments[${index}].id`,
    message: `Moment '${moment.id}' cannot be reached from a start moment.`,
    hint: "Add the transition that leads the user here, or remove the moment.",
  }]);
}

/** Pure semantic rules for a shape-valid behavior. Cross-file links are checked by the loader. */
export function validateBehaviorSemantics(behavior: Behavior, file: string): Issue[] {
  const issues: Issue[] = [
    ...duplicateIdIssues(behavior.moments.map((moment) => moment.id), file, "moments", "moment"),
    ...duplicateIdIssues(behavior.transitions.map((transition, index) => transitionId(transition, index)), file, "transitions", "transition"),
  ];
  const momentIds = new Set(behavior.moments.map((moment) => moment.id));
  behavior.transitions.forEach((transition, index) => {
    (["from", "to"] as const).forEach((key) => {
      if (!momentIds.has(transition[key])) {
        issues.push({
          severity: "error",
          file,
          path: `transitions[${index}].${key}`,
          message: `Transition references missing moment '${transition[key]}'.`,
          hint: `Add a moment with id '${transition[key]}', or point this transition at an existing moment.`,
        });
      }
    });
  });
  if (issues.some((issue) => issue.severity === "error")) {
    return issues;
  }
  issues.push(...unreachableMomentIssues(behavior, file));
  if (behavior.moments.length > MAX_RECOMMENDED_MOMENTS) {
    issues.push({
      severity: "warning",
      file,
      path: "moments",
      message: `Behavior has ${behavior.moments.length} moments, which is more than the recommended maximum of ${MAX_RECOMMENDED_MOMENTS}.`,
      hint: "Keep one behavior to one journey; split separate scenarios into separate behavior files.",
    });
  }
  return issues;
}

export type ParseBehaviorResult =
  | { ok: true; value: Behavior; warnings: Issue[] }
  | { ok: false; issues: Issue[] };

/** Parses, shape-validates, and semantically validates an `.codehq/behaviors/<id>.json` payload. */
export function parseBehavior(data: unknown, file: string): ParseBehaviorResult {
  const shapeResult = behaviorSchema.safeParse(data);
  if (!shapeResult.success) {
    return { ok: false, issues: zodErrorToIssues(shapeResult.error, file) };
  }
  const issues = validateBehaviorSemantics(shapeResult.data, file);
  return issues.some((issue) => issue.severity === "error")
    ? { ok: false, issues }
    : { ok: true, value: shapeResult.data, warnings: issues };
}
