/** Repository-local persistence for canvas visual state. */
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { WorkflowCanvasLayout } from "@schema/wire";
import { writeFileAtomic } from "./fs-utils";
import { codeHQPaths } from "./repository";

const pointSchema = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();

const viewEnum = z.enum(["flow", "wrap", "line"]);
const viewGeometrySchema = z.object({
  nodePositions: z.record(z.string(), pointSchema),
}).strict();

export const workflowCanvasLayoutSchema = z.object({
  nodePositions: z.record(z.string(), pointSchema),
  view: viewEnum.exactOptional(),
  otherViews: z.partialRecord(viewEnum, viewGeometrySchema).exactOptional(),
}).strict() satisfies z.ZodType<WorkflowCanvasLayout>;

// Disk state can contain removed fields. Drop them without losing saved card positions;
// API writes still use the strict schema above.
const storedLayoutSchema = workflowCanvasLayoutSchema.strip().extend({
  otherViews: z.partialRecord(viewEnum, viewGeometrySchema.strip()).exactOptional(),
});

const layoutFileSchema = z.object({
  version: z.literal(1),
  workflows: z.record(z.string(), storedLayoutSchema),
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
