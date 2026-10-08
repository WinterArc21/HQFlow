import { createRoot } from "react-dom/client";
import { useEffect, type ReactNode } from "react";
import { App, applyDocumentTheme, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";
import { OpenAIExtensions } from "@openai/mcp-extensions/app";
import { WorkflowCanvas } from "../components/canvas";
import { StepDrawer } from "../components/drawer";
import { ExportModeProvider } from "../export-viewer/ExportModeContext";
import { useCodeHQStore } from "../store/useCodeHQStore";
import type { ExportPayload } from "@schema/wire";
import "../styles/tokens.css";
import "../styles/reset.css";
import "../styles/base.css";
import "./plugin.css";

interface View {
  status: string;
  projectName: string;
  workflows: { id: string; name: string; purpose: string; stepCount: number }[];
  diagnostics: { severity: string; message: string }[];
  payload?: ExportPayload;
}

const app = new App({ name: "HQFlow", version: "1.0.0" });
new OpenAIExtensions(app);
const container = document.getElementById("root");
if (!container) throw new Error("Missing plugin root.");
const renderer = createRoot(container);
let current: View | undefined;
let latestRequest = 0;

function render(view?: View, error?: string) {
  if (view) current = view;
  renderer.render(<PluginApp view={current} {...(error === undefined ? {} : { error })} />);
}

async function call(name: string, args: Record<string, unknown>) {
  const request = ++latestRequest;
  try {
    const result = await app.callServerTool({ name, arguments: args });
    if (request !== latestRequest) return;
    if (result.isError) {
      render(undefined, result.content.filter((item) => item.type === "text").map((item) => item.text).join("\n"));
      return;
    }
    const data = result.structuredContent;
    if (data && Array.isArray(data.workflows)) {
      render(data as unknown as View);
      useCodeHQStore.getState().selectStep(null);
    }
  } catch (error) {
    if (request === latestRequest) render(undefined, error instanceof Error ? error.message : String(error));
  }
}

function Empty({ title, children, alert }: { title: string; children?: ReactNode; alert?: boolean }) {
  return <div className="hq-plugin-empty" role={alert ? "alert" : "status"}><strong>{title}</strong>{children}</div>;
}

function PluginApp({ view, error }: { view: View | undefined; error?: string }) {
  const selectedStepId = useCodeHQStore((state) => state.selectedStepId);
  const selectStep = useCodeHQStore((state) => state.selectStep);
  const payload = view?.payload;
  const firstWorkflow = view?.workflows[0]?.id;
  // Open a map straight away instead of showing an empty canvas.
  useEffect(() => {
    if (!error && payload === undefined && firstWorkflow !== undefined) void call("hqflow_get_workflow", { id: firstWorkflow });
  }, [error, payload, firstWorkflow]);
  const workflows = view?.workflows ?? [];
  let body: ReactNode;
  if (error) body = <Empty title="Something went wrong" alert>{error}</Empty>;
  else if (view === undefined) body = <Empty title="Loading workflows…" />;
  else if (view.status === "uninitialized") body = <Empty title="No HQFlow project here">Run <code>hqflow init</code> in your repository, or tell ChatGPT which repository to use.</Empty>;
  else if (workflows.length === 0) body = <Empty title="No workflows yet">Ask ChatGPT to map one, e.g. “map the checkout flow”.</Empty>;
  else body = <div className="hq-plugin-body">
    {workflows.length > 1 ? <nav className="hq-plugin-library" aria-label="Workflows">
      {workflows.map((workflow) => <button key={workflow.id} aria-current={payload?.workflowId === workflow.id ? "true" : undefined} onClick={() => void call("hqflow_get_workflow", { id: workflow.id })}>
        <strong>{workflow.name}</strong><span>{workflow.purpose}</span><small>{workflow.stepCount} steps</small>
      </button>)}
    </nav> : null}
    <section className="hq-plugin-canvas" aria-label="Workflow canvas">
      {payload ? <WorkflowCanvas key={payload.workflowId} workflow={payload.workflow} sourceChecks={payload.sourceChecks} /> : null}
    </section>
  </div>;
  return <ExportModeProvider value={{ hideFilePaths: false }}>
    <main className="hq-plugin">
      <header className="hq-plugin-header">
        <div className="hq-plugin-mark" aria-hidden="true" />
        <strong>HQFlow</strong>
        <span>{view?.projectName ?? "Workflows"}</span>
        {workflows.length > 0 ? <small className="hq-plugin-count">{workflows.length} {workflows.length === 1 ? "workflow" : "workflows"}</small> : null}
      </header>
      {view && view.diagnostics.length > 0 ? <details className="hq-plugin-diagnostics"><summary>{view.diagnostics.length} validation {view.diagnostics.length === 1 ? "issue" : "issues"}</summary><ul>{view.diagnostics.map((item, index) => <li key={index}>{item.severity}: {item.message}</li>)}</ul></details> : null}
      {body}
    </main>
    {payload && selectedStepId !== null ? <StepDrawer workflow={payload.workflow} stepId={selectedStepId} sourceChecks={payload.sourceChecks} onClose={() => selectStep(null)} /> : null}
  </ExportModeProvider>;
}

function applyContext(context: ReturnType<App["getHostContext"]>) {
  if (context?.theme) applyDocumentTheme(context.theme);
  if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
}
app.ontoolresult = (result) => {
  // The initial entrypoint result is delivered by the host; do not fetch it again.
  const data = result.structuredContent;
  if (result.isError) {
    render(undefined, result.content?.filter((item) => item.type === "text").map((item) => item.text).join("\n") ?? "HQFlow could not load this repository.");
  } else if (data && Array.isArray(data.workflows)) {
    latestRequest += 1;
    useCodeHQStore.getState().selectStep(null);
    render(data as unknown as View);
  }
};
app.addEventListener("hostcontextchanged", applyContext);
render();
app.connect().then(() => applyContext(app.getHostContext())).catch((error: unknown) => {
  render(undefined, error instanceof Error ? error.message : String(error));
});
