/**
 * The contract §8 HTTP API, minus `/api/events` (see `events.ts`).
 */

import path from "node:path";
import { unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { SourceLookup } from "@schema/wire";
import { pathExists } from "@core/fs-utils";
import { readWorkflowLayout, writeWorkflowLayout, type WorkflowLayoutPositions } from "@core/layout-store";
import { codeHQPaths } from "@core/repository";
import { resolveInsideRepository } from "@core/safe-path";
import type { CodeHQStore } from "@core/store";
import { buildExportHtml, buildContentDisposition, sanitizeExportPayload } from "./export";

export interface RouteContext {
  root: string;
  store: CodeHQStore;
}

const sourceQuerySchema = z
  .object({
    file: z.string().min(1, { message: "Query parameter 'file' is required." }),
    line: z
      .string()
      .regex(/^\d+$/, { message: "Query parameter 'line' must be a positive integer." })
      .optional(),
  })
  .strict();

const exportQuerySchema = z
  .object({
    hideFilePaths: z.enum(["true", "false"]).default("false"),
  })
  .strict();

const layoutPositionSchema = z.object({ x: z.number(), y: z.number() }).strict();
const saveLayoutBodySchema: z.ZodType<WorkflowLayoutPositions> = z.record(z.string(), layoutPositionSchema);

function buildEditorUrl(absolutePath: string, line: number | undefined): string {
  const forwardSlashPath = absolutePath.split(path.sep).join("/");
  const encodedPath = encodeURI(forwardSlashPath);
  return line !== undefined ? `vscode://file/${encodedPath}:${line}` : `vscode://file/${encodedPath}`;
}

function registerSourceRoute(app: FastifyInstance, root: string): void {
  app.get("/api/source", async (request, reply) => {
    const parsed = sourceQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      await reply.code(400).send({ error: "Invalid query parameters.", details: parsed.error.issues });
      return;
    }

    const resolved = resolveInsideRepository(root, parsed.data.file);
    if (!resolved.ok) {
      await reply.code(400).send({ error: resolved.reason });
      return;
    }

    const exists = await pathExists(resolved.absolutePath);
    const line = parsed.data.line !== undefined ? Number(parsed.data.line) : undefined;

    const lookup: SourceLookup = {
      file: parsed.data.file,
      absolutePath: resolved.absolutePath,
      exists,
      editorUrl: buildEditorUrl(resolved.absolutePath, line),
      ...(line !== undefined ? { line } : {}),
    };
    await reply.send(lookup);
  });
}

function resolveWorkflowFileForDeletion(root: string, relativeFile: string): { ok: true; absolutePath: string } | { ok: false; reason: string } {
  const resolved = resolveInsideRepository(root, relativeFile);
  if (!resolved.ok) {
    return resolved;
  }

  const paths = codeHQPaths(root);
  const workflowsDir = resolveInsideRepository(root, path.relative(root, paths.workflowsDir));
  if (!workflowsDir.ok) {
    return { ok: false, reason: workflowsDir.reason };
  }

  const relativeToWorkflows = path.relative(workflowsDir.absolutePath, resolved.absolutePath);
  const isDirectChild =
    relativeToWorkflows.length > 0 &&
    relativeToWorkflows !== ".." &&
    !relativeToWorkflows.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativeToWorkflows) &&
    path.dirname(relativeToWorkflows) === ".";
  if (!isDirectChild || path.extname(relativeToWorkflows).toLowerCase() !== ".json") {
    return { ok: false, reason: "Workflow file path is not an exact workflow file." };
  }

  return { ok: true, absolutePath: resolved.absolutePath };
}

function resolveExportViewerDir(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(currentDir, "..", "..", "dist", "export-viewer");
}

interface ExportViewerAssets {
  js: string;
  css: string;
}

let cachedExportViewerAssets: ExportViewerAssets | null = null;

async function loadExportViewerAssets(): Promise<ExportViewerAssets> {
  if (cachedExportViewerAssets !== null) {
    return cachedExportViewerAssets;
  }
  const { readFile } = await import("node:fs/promises");
  const dir = resolveExportViewerDir();
  const jsPath = path.join(dir, "export-viewer.js");
  const cssPath = path.join(dir, "export-viewer.css");
  const hasJs = await pathExists(jsPath);
  const hasCss = await pathExists(cssPath);
  if (!hasJs || !hasCss) {
    throw new Error(
      "Export viewer assets not found. Run `pnpm build:export` (or `pnpm build`) to generate dist/export-viewer/.",
    );
  }
  const [js, css] = await Promise.all([readFile(jsPath, "utf-8"), readFile(cssPath, "utf-8")]);
  cachedExportViewerAssets = { js, css };
  return cachedExportViewerAssets;
}

function registerExportRoute(app: FastifyInstance, store: CodeHQStore): void {
  app.get<{ Params: { id: string } }>("/api/export/:id", async (request, reply) => {
    const parsedQuery = exportQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      await reply.code(400).send({ error: "Invalid export query parameters.", details: parsedQuery.error.issues });
      return;
    }

    const record = store.getSnapshot().workflows.find((workflow) => workflow.id === request.params.id);
    if (record === undefined) {
      await reply.code(404).send({ error: `No workflow with id '${request.params.id}'.` });
      return;
    }

    let assets: ExportViewerAssets;
    try {
      assets = await loadExportViewerAssets();
    } catch (error) {
      await reply.code(503).send({
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const payload = sanitizeExportPayload(record, store.getSnapshot().repository.name, {
      hideFilePaths: parsedQuery.data.hideFilePaths === "true",
    });
    const html = buildExportHtml({ payload, viewerJs: assets.js, viewerCss: assets.css });

    await reply
      .type("text/html; charset=utf-8")
      .header("Content-Disposition", buildContentDisposition(payload.workflowName))
      .send(html);
  });
}

/** Registers every `/api/*` route except `/api/events` (SSE lives in `events.ts`). */
export function registerRoutes(app: FastifyInstance, context: RouteContext): void {
  const { root, store } = context;

  app.get("/api/state", async (_request, reply) => {
    await reply.send(store.getSnapshot());
  });

  app.get("/api/project", async (_request, reply) => {
    await reply.send(store.getSnapshot().project);
  });

  app.get("/api/workflows", async (_request, reply) => {
    await reply.send(store.getSnapshot().workflows);
  });

  app.get<{ Params: { id: string } }>("/api/workflows/:id", async (request, reply) => {
    const record = store.getSnapshot().workflows.find((workflow) => workflow.id === request.params.id);
    if (record === undefined) {
      await reply.code(404).send({ error: `No workflow with id '${request.params.id}'.` });
      return;
    }
    await reply.send(record);
  });

  app.delete<{ Params: { id: string } }>("/api/workflows/:id", async (request, reply) => {
    const record = store.getSnapshot().workflows.find((workflow) => workflow.id === request.params.id);
    if (record === undefined) {
      await reply.code(404).send({ error: `No workflow with id '${request.params.id}'.` });
      return;
    }

    if (record.state !== "valid" || record.workflow.status !== "verified") {
      await reply.code(409).send({ error: "Only verified workflows can be deleted." });
      return;
    }

    const resolved = resolveWorkflowFileForDeletion(root, record.file);
    if (!resolved.ok) {
      await reply.code(400).send({ error: resolved.reason });
      return;
    }

    try {
      await unlink(resolved.absolutePath);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        await store.reload();
        await reply.code(404).send({ error: "The workflow file no longer exists." });
        return;
      }
      await reply.code(500).send({ error: error instanceof Error ? error.message : String(error) });
      return;
    }

    await reply.send(await store.reload());
  });

  app.get("/api/diagnostics", async (_request, reply) => {
    await reply.send(store.getSnapshot().diagnostics);
  });

  app.get<{ Params: { id: string } }>("/api/workflows/:id/layout", async (request, reply) => {
    const record = store.getSnapshot().workflows.find((workflow) => workflow.id === request.params.id);
    if (record === undefined) {
      await reply.code(404).send({ error: `No workflow with id '${request.params.id}'.` });
      return;
    }
    const positions = await readWorkflowLayout(root, request.params.id);
    await reply.send({ positions: positions ?? {} });
  });

  app.put<{ Params: { id: string } }>("/api/workflows/:id/layout", async (request, reply) => {
    const record = store.getSnapshot().workflows.find((workflow) => workflow.id === request.params.id);
    if (record === undefined) {
      await reply.code(404).send({ error: `No workflow with id '${request.params.id}'.` });
      return;
    }
    const parsed = saveLayoutBodySchema.safeParse(request.body);
    if (!parsed.success) {
      await reply.code(400).send({ error: "Invalid layout payload.", details: parsed.error.issues });
      return;
    }
    await writeWorkflowLayout(root, request.params.id, parsed.data);
    await reply.code(204).send();
  });

  registerSourceRoute(app, root);

  app.post("/api/recheck", async (_request, reply) => {
    const snapshot = await store.reload();
    await reply.send(snapshot);
  });

  registerExportRoute(app, store);
}
