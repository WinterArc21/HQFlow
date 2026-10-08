import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { loadHQ } from "@core/load";
import { resolveInsideRepository } from "@core/safe-path";
import { parseWorkflow } from "@schema/validate";
import { sanitizeExportPayload } from "./export";

export const MAX_WORKFLOW_BYTES = 1024 * 1024;

function metadataPath(root: string, relativeFile: string): string {
  const safe = resolveInsideRepository(root, relativeFile);
  if (!safe.ok) throw new Error(safe.reason);
  const normalize = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
  if (normalize(safe.absolutePath) !== normalize(path.resolve(root, relativeFile))) {
    throw new Error("HQFlow plugin metadata paths must not be redirected through symlinks.");
  }
  return safe.absolutePath;
}

export async function resolvePluginRoot(root: string): Promise<string> {
  if (!path.isAbsolute(root)) throw new Error("Choose an absolute repository path.");
  const resolved = await fs.realpath(root);
  if (!(await fs.stat(resolved)).isDirectory()) throw new Error("Repository path must be a directory.");
  for (const relativeFile of [".codehq", ".codehq/project.json", ".codehq/repository-map.json", ".codehq/workflows"]) {
    metadataPath(resolved, relativeFile);
  }
  return resolved;
}

export async function readPluginProject(root: string) {
  await resolvePluginRoot(root);
  const loaded = await loadHQ(root);
  const workflows = loaded.files.flatMap((file) => file.status === "valid" ? [file.loaded] : []);
  const projectName = loaded.project?.project.name ?? path.basename(root);
  return { loaded, workflows, projectName };
}

export async function pluginView(root: string, workflowId?: string) {
  const { loaded, workflows, projectName } = await readPluginProject(root);
  const selected = workflowId === undefined ? undefined : workflows.find((item) => item.id === workflowId);
  if (workflowId !== undefined && selected === undefined) throw new Error(`Unknown or invalid workflow: ${workflowId}`);
  return {
    status: loaded.status,
    projectName,
    workflows: workflows.map(({ workflow, modifiedAt }) => ({
      id: workflow.id, name: workflow.name, purpose: workflow.purpose,
      stepCount: workflow.steps.length, modifiedAt,
    })),
    diagnostics: loaded.issues,
    ...(selected === undefined ? {} : {
      payload: sanitizeExportPayload({ ...selected, state: "valid" }, projectName),
    }),
  };
}

/** Validates before touching disk, confines writes to workflows/, and publishes atomically. */
export async function savePluginWorkflow(root: string, workflowJson: string, overwrite = false) {
  if (Buffer.byteLength(workflowJson, "utf8") > MAX_WORKFLOW_BYTES) throw new Error("Workflow exceeds the 1 MiB limit.");
  const parsed = parseWorkflow(JSON.parse(workflowJson) as unknown, ".codehq/workflows/<id>.json");
  if (!parsed.ok) return { saved: false, issues: parsed.issues };
  const workflow = parsed.value;
  if (!/^[a-z0-9][a-z0-9_-]{0,127}$/.test(workflow.id)) {
    throw new Error("Saved workflow IDs must use lowercase letters, digits, hyphens or underscores (maximum 128 characters).");
  }
  const { loaded, workflows } = await readPluginProject(root);
  if (loaded.project === null) throw new Error("Initialize this repository with hqflow init before saving workflows.");
  const relativeFile = `.codehq/workflows/${workflow.id}.json`;
  const existing = workflows.find((item) => item.id === workflow.id);
  if (existing !== undefined && existing.file !== relativeFile) {
    throw new Error(`Workflow ID already belongs to ${existing.file}. Rename that file before saving through the plugin.`);
  }
  const destination = metadataPath(await fs.realpath(root), relativeFile);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = path.join(path.dirname(destination), `.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, `${JSON.stringify(workflow, null, 2)}\n`, { flag: "wx" });
    if (overwrite) {
      await fs.rename(temporary, destination);
    } else {
      // link is atomic and fails if the destination exists, even with concurrent writers.
      await fs.link(temporary, destination);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("Workflow already exists. Use overwrite=true only when the user requested replacement.");
    }
    throw error;
  } finally {
    await fs.rm(temporary, { force: true });
  }
  return { saved: true, file: relativeFile, warnings: parsed.warnings, ...await pluginView(root, workflow.id) };
}
