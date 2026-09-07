import { z } from "zod";
import { sourceReferenceSchema } from "./workflow";

const repositoryWorkflowSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, {
      message: "RepositoryWorkflow.id must use lowercase letters, digits, and hyphens.",
    }),
    name: z.string().min(1, { message: "RepositoryWorkflow.name must not be empty." }),
    purpose: z.string().min(1, { message: "RepositoryWorkflow.purpose must not be empty." }),
    entryPoint: sourceReferenceSchema.optional(),
  })
  .strict();

const repositoryConnectionSchema = z
  .object({
    from: z.string().min(1, { message: "RepositoryConnection.from must not be empty." }),
    to: z.string().min(1, { message: "RepositoryConnection.to must not be empty." }),
    label: z.string().min(1).optional(),
    type: z.enum(["success", "failure", "conditional", "async"]).optional(),
    sources: z.array(sourceReferenceSchema).min(1, {
      message: "RepositoryConnection.sources must contain evidence for this handoff.",
    }),
  })
  .strict();

export const repositoryMapSchema = z
  .object({
    schemaVersion: z.literal("0.1", { message: 'RepositoryMap.schemaVersion must be "0.1".' }),
    workflows: z.array(repositoryWorkflowSchema).min(1, {
      message: "RepositoryMap.workflows must contain at least one workflow.",
    }),
    connections: z.array(repositoryConnectionSchema),
  })
  .strict();

export type RepositoryWorkflow = z.infer<typeof repositoryWorkflowSchema>;
export type RepositoryConnection = z.infer<typeof repositoryConnectionSchema>;
export type RepositoryMap = z.infer<typeof repositoryMapSchema>;
