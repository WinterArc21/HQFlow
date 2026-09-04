/** Repository-local persistence for canvas visual state. */
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { WorkflowCanvasLayout } from "@schema/wire";
import { writeFileAtomic } from "./fs-utils";
import { codeHQPaths } from "./repository";

const pointSchema = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();
const bendSchema = z.object({
  point: pointSchema,
  snap: z.enum(["source-x", "target-x"]).nullable(),
}).strict();

export const workflowCanvasLayoutSchema: z.ZodType<WorkflowCanvasLayout> = z.object({
  nodePositions: z.record(z.string(), pointSchema),
  edgeBends: z.record(z.string(), bendSchema),
  viewport: z.object({ x: z.number().finite(), y: z.number().finite(), zoom: z.number().finite().positive() }).strict().optional(),
  expandedStepIds: z.record(z.string(), z.literal(true)),
}).strict();

const layoutFileSchema = z.object({
  version: z.literal(1),
  workflows: z.record(z.string(), workflowCanvasLayoutSchema),
}).strict();

type LayoutFile = z.infer<typeof layoutFileSchema>;
const mutationQueues = new Map<string, Promise<void>>();

function layoutFilePath(root: string): string {
  return path.join(codeHQPaths(root).runtimeDir, "layout.json");
}

async function readLayoutFile(root: string): Promise<LayoutFile> {
  const filePath = layoutFilePath(root);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { version: 1, workflows: {} };
    }
    throw error;
  }

  const parsed = layoutFileSchema.safeParse(JSON.parse(raw) as unknown);
  if (!parsed.success) {
    throw new Error(`Invalid canvas layout file '${filePath}': ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

async function mutateLayoutFile(root: string, mutate: (file: LayoutFile) => void): Promise<void> {
  const filePath = layoutFilePath(root);
  const previous = mutationQueues.get(filePath) ?? Promise.resolve();
  const operation = previous.catch(() => undefined).then(async () => {
    const file = await readLayoutFile(root);
    mutate(file);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await writeFileAtomic(filePath, `${JSON.stringify(file, null, 2)}\n`);
  });
  mutationQueues.set(filePath, operation);
  try {
    await operation;
  } finally {
    if (mutationQueues.get(filePath) === operation) {
      mutationQueues.delete(filePath);
    }
  }
}

export async function readWorkflowCanvasLayout(root: string, workflowId: string): Promise<WorkflowCanvasLayout | null> {
  return (await readLayoutFile(root)).workflows[workflowId] ?? null;
}

export async function writeWorkflowCanvasLayout(
  root: string,
  workflowId: string,
  layout: WorkflowCanvasLayout,
): Promise<void> {
  await mutateLayoutFile(root, (file) => {
    file.workflows[workflowId] = layout;
  });
}

export async function deleteWorkflowCanvasLayout(root: string, workflowId: string): Promise<void> {
  await mutateLayoutFile(root, (file) => {
    delete file.workflows[workflowId];
  });
}
