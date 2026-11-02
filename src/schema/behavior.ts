import { z } from "zod";
import { idSchema, requiredTextSchema, sourceReferenceSchema, testReferenceSchema, type Workflow } from "./workflow";

/**
 * A behavior map tells one user journey from the user's point of view: each moment is something
 * the user sees or does, and each transition is the event that moves them on. Moments link down to
 * the workflow steps that cause them, so the two views never describe the same thing twice.
 */

export const verdictStatusSchema = z.enum(["works", "bug", "fixed"]);

/** What the agent proved about a moment or a transition, and the proof. */
export const verdictSchema = z
  .object({
    status: verdictStatusSchema,
    evidence: requiredTextSchema("Verdict.evidence"),
    tests: z.array(testReferenceSchema).optional(),
  })
  .strict();

/** A workflow step that causes a moment. */
export const stepLinkSchema = z
  .object({
    workflow: z.string().min(1, { message: "StepLink.workflow must not be empty." }),
    step: z.string().min(1, { message: "StepLink.step must not be empty." }),
  })
  .strict();

export const behaviorMomentSchema = z
  .object({
    id: idSchema("BehaviorMoment.id"),
    name: requiredTextSchema("BehaviorMoment.name"),
    purpose: requiredTextSchema("BehaviorMoment.purpose"),
    kind: z.enum(["start", "end"]).optional(),
    sources: z.array(sourceReferenceSchema).optional(),
    causedBy: z.array(stepLinkSchema).optional(),
    verdict: verdictSchema.optional(),
  })
  .strict();

export const behaviorTransitionSchema = z
  .object({
    id: idSchema("BehaviorTransition.id").optional(),
    from: z.string().min(1, { message: "BehaviorTransition.from must not be empty." }),
    to: z.string().min(1, { message: "BehaviorTransition.to must not be empty." }),
    label: requiredTextSchema("BehaviorTransition.label"),
    sources: z.array(sourceReferenceSchema).optional(),
    verdict: verdictSchema.optional(),
  })
  .strict();

export const behaviorSchema = z
  .object({
    schemaVersion: z.literal("0.1", { message: "Behavior.schemaVersion must be \"0.1\"." }),
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, {
      message: "Behavior.id must match ^[a-z0-9][a-z0-9-]*$ (lowercase letters, digits, and hyphens).",
    }).refine((id) => !Object.getOwnPropertyNames(Object.prototype).includes(id), {
      message: "Behavior.id must not be a reserved JavaScript property name such as 'constructor'.",
    }),
    name: requiredTextSchema("Behavior.name"),
    purpose: requiredTextSchema("Behavior.purpose"),
    moments: z.array(behaviorMomentSchema).min(1, { message: "Behavior.moments must contain at least one moment." }),
    transitions: z.array(behaviorTransitionSchema),
    notes: z.array(z.string()).optional(),
  })
  .strict();

export type VerdictStatus = z.infer<typeof verdictStatusSchema>;
export type Verdict = z.infer<typeof verdictSchema>;
export type StepLink = z.infer<typeof stepLinkSchema>;
export type BehaviorMoment = z.infer<typeof behaviorMomentSchema>;
export type BehaviorTransition = z.infer<typeof behaviorTransitionSchema>;
export type Behavior = z.infer<typeof behaviorSchema>;

/** The canvas edge id for a transition: its own id, or one derived from its position. */
export function transitionId(transition: BehaviorTransition, index: number): string {
  return transition.id ?? `transition-${index}`;
}

/**
 * Draws a behavior on the workflow canvas: moments become steps and transitions become
 * connections. A start moment takes the entry category, so the layout begins there; every other
 * moment is plain, because the behavior canvas marks ends itself instead of drawing outcome pills.
 * A verdict's tests become the step's tests.
 */
export function behaviorAsWorkflow(behavior: Behavior): Workflow {
  return {
    schemaVersion: "0.1",
    id: behavior.id,
    name: behavior.name,
    purpose: behavior.purpose,
    steps: behavior.moments.map((moment) => ({
      id: moment.id,
      name: moment.name,
      purpose: moment.purpose,
      category: moment.kind === "start" ? "entry" : "logic",
      ...(moment.sources !== undefined ? { sources: moment.sources } : {}),
      ...(moment.verdict?.tests !== undefined ? { tests: moment.verdict.tests } : {}),
    })),
    connections: behavior.transitions.map((transition, index) => ({
      id: transitionId(transition, index),
      from: transition.from,
      to: transition.to,
      label: transition.label,
    })),
    ...(behavior.notes !== undefined ? { notes: behavior.notes } : {}),
  };
}
