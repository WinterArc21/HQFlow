/**
 * Server-side export helper: sanitizes a `WorkflowRecord` into an `ExportPayload`, then
 * inlines that payload together with the pre-built export-viewer JS/CSS into a single
 * self-contained HTML file that renders an interactive, offline workflow snapshot.
 *
 * Machine-local data (repository root, codehq directory, absolute paths, the workflow
 * file's own path) is stripped. The workflow's repository-relative source paths are kept
 * (they are part of the agent-authored description) but source file *contents* are never
 * included — the payload only carries the already-validated `Workflow` JSON and the
 * `sourceChecks` status map.
 */
import type { Workflow } from "@schema/workflow";
import type { ExportPayload, SourceStatus } from "@schema/wire";
import type { WorkflowRecord } from "@core/types";

export type { ExportPayload } from "@schema/wire";

export interface SanitizeExportPayloadOptions {
  exportedAt?: string;
  hideFilePaths?: boolean;
}

const REDACTED_FILE_PREFIX = "redacted-file-";

function redactedFileLabel(index: number): string {
  return `${REDACTED_FILE_PREFIX}${index}`;
}

function collectWorkflowFiles(workflow: Workflow): string[] {
  const files: string[] = [];
  const seen = new Set<string>();
  const collect = (file: string): void => {
    if (!seen.has(file)) {
      seen.add(file);
      files.push(file);
    }
  };

  if (workflow.entryPoint !== undefined) {
    collect(workflow.entryPoint.file);
  }
  for (const step of workflow.steps) {
    for (const source of step.sources ?? []) {
      collect(source.file);
    }
    for (const test of step.tests ?? []) {
      collect(test.file);
    }
    for (const edgeCase of step.edgeCases ?? []) {
      for (const source of edgeCase.sources ?? []) {
        collect(source.file);
      }
    }
  }
  return files;
}

function redactWorkflow(workflow: Workflow, redactFile: (file: string) => string): Workflow {
  const redactSource = <T extends { file: string }>(source: T): T => ({
    ...source,
    file: redactFile(source.file),
  });

  return {
    ...workflow,
    ...(workflow.entryPoint !== undefined ? { entryPoint: redactSource(workflow.entryPoint) } : {}),
    steps: workflow.steps.map((step) => ({
      ...step,
      ...(step.sources !== undefined ? { sources: step.sources.map(redactSource) } : {}),
      ...(step.tests !== undefined ? { tests: step.tests.map(redactSource) } : {}),
      ...(step.edgeCases !== undefined
        ? {
            edgeCases: step.edgeCases.map((edgeCase) => ({
              ...edgeCase,
              ...(edgeCase.sources !== undefined ? { sources: edgeCase.sources.map(redactSource) } : {}),
            })),
          }
        : {}),
    })),
  };
}

function redactSourceCheckKey(key: string, knownFiles: string[], redactFile: (file: string) => string): string {
  const matchingFile = [...knownFiles]
    .sort((left, right) => right.length - left.length)
    .find((file) => key === file || key.startsWith(`${file}#`));
  if (matchingFile !== undefined) {
    return `${redactFile(matchingFile)}${key.slice(matchingFile.length)}`;
  }

  const separator = key.indexOf("#");
  const file = separator === -1 ? key : key.slice(0, separator);
  return `${redactFile(file)}${separator === -1 ? "" : key.slice(separator)}`;
}

function redactSourceChecks(
  sourceChecks: Record<string, SourceStatus>,
  knownFiles: string[],
  redactFile: (file: string) => string,
): Record<string, SourceStatus> {
  return Object.fromEntries(
    Object.entries(sourceChecks).map(([key, status]) => [redactSourceCheckKey(key, knownFiles, redactFile), status]),
  );
}

/**
 * Strips machine-local data from a `WorkflowRecord` and its repository context, producing
 * the minimal payload the export viewer needs. `record.file` (the workflow JSON's own path,
 * which would expose the `.codehq` directory layout) is intentionally dropped — only the
 * workflow's internal source references (already validated as repository-relative) survive.
 */
export function sanitizeExportPayload(
  record: WorkflowRecord,
  repositoryName: string,
  options: SanitizeExportPayloadOptions = {},
): ExportPayload {
  const shouldHideFilePaths = options.hideFilePaths === true;
  const knownFiles = collectWorkflowFiles(record.workflow);
  const redactedFiles = new Map<string, string>();
  const redactFile = (file: string): string => {
    const existing = redactedFiles.get(file);
    if (existing !== undefined) {
      return existing;
    }
    const label = redactedFileLabel(redactedFiles.size + 1);
    redactedFiles.set(file, label);
    return label;
  };

  const workflow = shouldHideFilePaths ? redactWorkflow(record.workflow, redactFile) : record.workflow;
  const sourceChecks = shouldHideFilePaths
    ? redactSourceChecks(record.sourceChecks, knownFiles, redactFile)
    : record.sourceChecks;

  return {
    workflow,
    sourceChecks,
    hideFilePaths: shouldHideFilePaths,
    workflowName: record.workflow.name,
    workflowId: record.id,
    exportedAt: options.exportedAt ?? new Date().toISOString(),
    repositoryName,
  };
}

/**
 * Sanitizes a workflow name into a safe, stable filename component: ASCII alphanumerics,
 * hyphens, and underscores only, lowercased, whitespace collapsed to single hyphens.
 */
export function sanitizeFilename(name: string): string {
  const slug = name
    .replace(/[^a-zA-Z0-9-_ ]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .toLowerCase()
    .slice(0, 80);
  return slug.length > 0 ? slug : "workflow";
}

/** Escapes a JSON string so it is safe to embed inside `<script type="application/json">`. */
function escapeJsonForScript(json: string): string {
  return json
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** Escapes a JS string so it is safe to inline inside a `<script>` tag. */
function escapeScriptContent(js: string): string {
  return js.replace(/<\/script/gi, "<\\/script");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface BuildExportHtmlOptions {
  payload: ExportPayload;
  viewerJs: string;
  viewerCss: string;
}

/**
 * Assembles the final self-contained HTML: inline `<style>` with the export viewer's CSS,
 * an `<script type="application/json">` payload, and an inline `<script>` with the IIFE
 * viewer bundle. No external `src`, `href`, `link`, or CDN references — the file works
 * offline from `file://`.
 */
export function buildExportHtml({ payload, viewerJs, viewerCss }: BuildExportHtmlOptions): string {
  const payloadJson = escapeJsonForScript(JSON.stringify(payload));
  const title = `${payload.workflowName} — HQFlow Export`;

  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
${viewerCss}
</style>
<script>(function(){try{var r=localStorage.getItem("codehq.ui");if(r){var p=JSON.parse(r);var t=p&&p.state&&p.state.theme;if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);}}}catch(e){}})();</script>
</head>
<body>
<div id="root"></div>
<script type="application/json" id="codehq-export-payload">${payloadJson}</script>
<script>
${escapeScriptContent(viewerJs)}
</script>
</body>
</html>`;
}

/** Builds the Content-Disposition header value for a download. */
export function buildContentDisposition(workflowName: string): string {
  const slug = sanitizeFilename(workflowName);
  const filename = `${slug}-codehq.html`;
  return `attachment; filename="${filename}"`;
}
