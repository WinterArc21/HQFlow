import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { REPO_ROOT } from "./helpers/paths";

test("bundled plugin serves a canvas through the MCP Apps host bridge", async ({ page }, testInfo) => {
  const root = await mkdtemp(path.join(tmpdir(), "hqflow-plugin-browser-"));
  const installed = path.join(root, "installed");
  const repository = path.join(root, "repository");
  const client = new Client({ name: "browser-test", version: "1.0.0" });
  try {
    // A cached install outside HQFlow has no node_modules: the bundle must stand alone.
    await cp(path.join(REPO_ROOT, "dist/hqflow-plugin"), installed, { recursive: true });
    await mkdir(path.join(repository, ".codehq/workflows"), { recursive: true });
    await writeFile(path.join(repository, "checkout.ts"), "export function checkout() {}\n");
    await writeFile(path.join(repository, ".codehq/project.json"), JSON.stringify({ schemaVersion: "0.1", project: { id: "test", name: "Plugin Test" } }));
    await writeFile(path.join(repository, ".codehq/workflows/checkout.json"), JSON.stringify({
      schemaVersion: "0.1", id: "checkout", name: "Checkout", purpose: "Create an order.",
      entryPoint: { file: "checkout.ts", symbol: "checkout" },
      steps: [{ id: "create-order", name: "Create Order", purpose: "Persist the new order.", category: "entry", sources: [{ file: "checkout.ts", symbol: "checkout", line: 1 }] }], connections: [],
    }));
    await client.connect(new StdioClientTransport({ command: process.execPath, args: ["./dist/server.js"], cwd: installed, env: { ...process.env, HQFLOW_ROOT: repository } as Record<string, string> }));
    const initial = await client.callTool({ name: "hqflow_open", arguments: {} }) as CallToolResult;
    expect(initial.isError).not.toBe(true);
    const ui = await client.readResource({ uri: "ui://hqflow/workflow-canvas-v1" });
    const content = ui.contents[0];
    if (!content || !("text" in content)) throw new Error("Plugin UI missing.");
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.exposeFunction("pluginCall", async (params: { name: string; arguments: Record<string, unknown> }) => client.callTool(params));
    await page.setContent('<iframe id="plugin" title="HQFlow" style="border:0;width:100%;height:850px"></iframe>');
    await page.evaluate(({ html, initialResult }) => {
      const frame = document.getElementById("plugin") as HTMLIFrameElement;
      const send = (value: unknown) => frame.contentWindow?.postMessage(value, "*");
      window.addEventListener("message", async (event: MessageEvent) => {
        if (event.source !== frame.contentWindow) return;
        const message = event.data as { jsonrpc: string; id?: number; method: string; params: Record<string, unknown> };
        if (message.method === "ui/initialize") {
          send({ jsonrpc: "2.0", id: message.id, result: {
            protocolVersion: message.params.protocolVersion, hostInfo: { name: "HQFlow test host", version: "1.0.0" },
            hostCapabilities: { serverTools: {}, serverResources: {} }, hostContext: { theme: "dark", displayMode: "fullscreen" },
          } });
        } else if (message.method === "ui/notifications/initialized") {
          send({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: initialResult });
        } else if (message.method === "tools/call") {
          const host = window as unknown as { pluginCall(params: unknown): Promise<unknown> };
          send({ jsonrpc: "2.0", id: message.id, result: await host.pluginCall(message.params) });
        } else if (message.id !== undefined) {
          send({ jsonrpc: "2.0", id: message.id, result: {} });
        }
      });
      frame.srcdoc = html;
    }, { html: content.text, initialResult: initial });
    const frame = page.frameLocator("#plugin");
    try {
      await expect(frame.getByText("Plugin Test", { exact: true })).toBeVisible();
    } catch (error) {
      throw new Error(`Plugin UI failed to mount: ${errors.join("; ")}`, { cause: error });
    }
    // The only workflow opens on its own; no library rail or repository form.
    await expect(frame.getByRole("navigation", { name: "Workflows" })).toHaveCount(0);
    await expect(frame.locator(".react-flow__node")).toHaveCount(1);
    await expect(frame.getByText("Create Order", { exact: true })).toBeVisible();
    await frame.locator(".react-flow__node").click();
    await expect(frame.getByRole("dialog")).toBeVisible();
    await expect(frame.getByText("checkout.ts", { exact: false }).first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("hqflow-plugin.png"), fullPage: true });
    expect(errors).toEqual([]);
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});
