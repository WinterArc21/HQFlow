import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App as McpApp, applyDocumentTheme, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";
import { OpenAIExtensions } from "@openai/mcp-extensions/app";
import { App } from "../App";
import { useCodeHQStore } from "../store/useCodeHQStore";
import { installApiBridge } from "./bridge";
import "../styles/tokens.css";
import "../styles/reset.css";
import "../styles/base.css";

const host = new McpApp({ name: "HQFlow", version: "1.0.0" });
new OpenAIExtensions(host);
const bridge = installApiBridge(host);

host.ontoolresult = (result) => {
  // Saves and repository changes made from chat show up without a reload.
  bridge.push();
  const payload = (result.structuredContent as { payload?: { workflowId?: unknown } } | undefined)?.payload;
  if (typeof payload?.workflowId === "string") useCodeHQStore.getState().selectWorkflow(payload.workflowId);
};
function applyContext(context: ReturnType<McpApp["getHostContext"]>) {
  if (context?.theme) {
    applyDocumentTheme(context.theme);
    // HQFlow's toggle owns `data-theme`; follow ChatGPT's theme through its store.
    useCodeHQStore.getState().setTheme(context.theme);
  }
  if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
}
host.addEventListener("hostcontextchanged", applyContext);

const container = document.getElementById("root");
if (container === null) throw new Error("Missing plugin root.");
// The app's first `/api/state` request needs the host connection, so render after connecting.
host.connect().then(() => applyContext(host.getHostContext())).finally(() => {
  createRoot(container).render(<StrictMode><App /></StrictMode>);
});
