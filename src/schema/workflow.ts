import { z } from "zod";
import { describePathProblem } from "./paths";

/**
 * A repository-relative path. Shape-level rejection of absolute paths, drive letters, UNC
 * paths, and `..` segments happens here so bad paths never make it into a parsed Workflow.
 */
const repoRelativePathSchema = z.string().min(1, { message: "Path must not be empty." }).superRefine((value, ctx) => {
  const problem = describePathProblem(value);
  if (problem) {
    ctx.addIssue({ code: "custom", message: problem });
  }
});

const stepCategorySchema = z.enum(["entry", "logic", "decision", "data", "external", "output"]);

const connectionTypeSchema = z.enum(["success", "failure", "conditional", "async"]);

export const sourceReferenceSchema = z
  .object({
    file: repoRelativePathSchema,
    symbol: z.string().min(1).optional(),
    line: z.number().int().positive().optional(),
    endLine: z.number().int().positive().optional(),
    description: z.string().optional(),
  })
  .strict()
  .superRefine((ref, ctx) => {
    if (ref.line !== undefined && ref.endLine !== undefined && ref.line > ref.endLine) {
      ctx.addIssue({
        code: "custom",
        message: `SourceReference.line (${ref.line}) must not be greater than endLine (${ref.endLine}).`,
        path: ["line"],
      });
    }
  });

export const dataReferenceSchema = z
  .object({
    name: z.string().min(1, { message: "DataReference.name must not be empty." }),
    type: z.string().min(1).optional(),
    description: z.string().optional(),
  })
  .strict();

export const edgeCaseSchema = z
  .object({
    name: z.string().min(1, { message: "EdgeCase.name must not be empty." }),
    description: z.string().optional(),
    handling: z.string().optional(),
    sources: z.array(sourceReferenceSchema).optional(),
  })
  .strict();

export const testReferenceSchema = z
  .object({
    file: repoRelativePathSchema,
    symbol: z.string().min(1).optional(),
    description: z.string().optional(),
  })
  .strict();

export const externalServiceReferenceSchema = z
  .object({
    name: z.string().min(1, { message: "ExternalServiceReference.name must not be empty." }),
    purpose: z.string().optional(),
    operation: z.string().optional(),
  })
  .strict();

const stepDetailsSchema = z
  .object({
    implementation: z.string().optional(),
    importantDecisions: z.array(z.string()).optional(),
    assumptions: z.array(z.string()).optional(),
  })
  .strict();

export const workflowStepSchema = z
  .object({
    id: z.string().min(1, { message: "WorkflowStep.id must not be empty." }),
    name: z.string().min(1, { message: "WorkflowStep.name must not be empty." }),
    purpose: z.string().min(1, { message: "WorkflowStep.purpose must not be empty." }),
    category: stepCategorySchema.optional(),
    sources: z.array(sourceReferenceSchema).optional(),
    inputs: z.array(dataReferenceSchema).optional(),
    outputs: z.array(dataReferenceSchema).optional(),
    edgeCases: z.array(edgeCaseSchema).optional(),
    tests: z.array(testReferenceSchema).optional(),
    externalServices: z.array(externalServiceReferenceSchema).optional(),
    details: stepDetailsSchema.optional(),
  })
  .strict();

export const workflowConnectionSchema = z
  .object({
    id: z.string().min(1).optional(),
    from: z.string().min(1, { message: "WorkflowConnection.from must not be empty." }),
    to: z.string().min(1, { message: "WorkflowConnection.to must not be empty." }),
    label: z.string().optional(),
    condition: z.string().optional(),
    type: connectionTypeSchema.optional(),
  })
  .strict();

export const workflowSchema = z
  .object({
    schemaVersion: z.literal("0.1", { message: "Workflow.schemaVersion must be \"0.1\"." }),
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, {
      message: "Workflow.id must match ^[a-z0-9][a-z0-9-]*$ (lowercase letters, digits, and hyphens).",
    }),
    name: z.string().min(1, { message: "Workflow.name must not be empty." }),
    purpose: z.string().min(1, { message: "Workflow.purpose must not be empty." }),
    entryPoint: sourceReferenceSchema.optional(),
    steps: z.array(workflowStepSchema).min(1, { message: "Workflow.steps must contain at least one step." }),
    connections: z.array(workflowConnectionSchema),
    notes: z.array(z.string()).optional(),
  })
  .strict();

export type SourceReference = z.infer<typeof sourceReferenceSchema>;
export type DataReference = z.infer<typeof dataReferenceSchema>;
export type EdgeCase = z.infer<typeof edgeCaseSchema>;
export type TestReference = z.infer<typeof testReferenceSchema>;
export type ExternalServiceReference = z.infer<typeof externalServiceReferenceSchema>;
export type WorkflowStep = z.infer<typeof workflowStepSchema>;
export type WorkflowConnection = z.infer<typeof workflowConnectionSchema>;
export type Workflow = z.infer<typeof workflowSchema>;
