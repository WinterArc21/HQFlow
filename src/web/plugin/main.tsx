import { createRoot } from "react-dom/client";
import { useState } from "react";
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

function PluginApp({ view, error }: { view: View | undefined; error?: string }) {
  const [repositoryPath, setRepositoryPath] = useState("");
  const selectedStepId = useCodeHQStore((state) => state.selectedStepId);
  const selectStep = useCodeHQStore((state) => state.selectStep);
  const payload = view?.payload;
  return <ExportModeProvider value={{ hideFilePaths: false }}>
    <main className="hq-plugin">
      <header className="hq-plugin-header">
        <div><strong>HQFlow</strong><span>{view?.projectName ?? "Workflow Library"}</span></div>
        <button onClick={() => void call("hqflow_open", {})}>Refresh</button>
      </header>
      <form className="hq-plugin-repository" onSubmit={(event) => { event.preventDefault(); void call("hqflow_select_repository", { root: repositoryPath }); }}>
        <label htmlFor="repository-path">Repository</label>
        <input id="repository-path" value={repositoryPath} onChange={(event) => setRepositoryPath(event.target.value)} placeholder="Absolute path to your repository" required />
        <button type="submit">Connect</button>
      </form>
      {error ? <p role="alert" className="hq-plugin-message">{error}</p> : null}
      {view === undefined ? <p role="status" className="hq-plugin-message">Connecting to HQFlow…</p> : null}
      {view?.status === "uninitialized" ? <p className="hq-plugin-message">Choose your repository above. Run <code>hqflow init</code> there to create its .codehq folder.</p> : null}
      {view && view.status !== "uninitialized" && view.workflows.length === 0 ? <p className="hq-plugin-message">No valid workflows yet. Ask ChatGPT to map a workflow from your repository source.</p> : null}
      {view && view.diagnostics.length > 0 ? <details className="hq-plugin-message"><summary>Validation diagnostics ({view.diagnostics.length})</summary><ul>{view.diagnostics.map((item, index) => <li key={index}>{item.severity}: {item.message}</li>)}</ul></details> : null}
      <div className="hq-plugin-body">
        <nav className="hq-plugin-library" aria-label="Workflows">
          {view?.workflows.map((workflow) => <button key={workflow.id} aria-current={payload?.workflowId === workflow.id ? "true" : undefined} onClick={() => void call("hqflow_get_workflow", { id: workflow.id })}>
            <strong>{workflow.name}</strong><span>{workflow.purpose}</span><small>{workflow.stepCount} steps</small>
          </button>)}
        </nav>
        <section className="hq-plugin-canvas" aria-label="Workflow canvas">
          {payload ? <WorkflowCanvas key={payload.workflowId} workflow={payload.workflow} sourceChecks={payload.sourceChecks} /> : view && view.workflows.length > 0 ? <p className="hq-plugin-message">Select a workflow to explore its steps, branches, and source references.</p> : null}
        </section>
      </div>
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
