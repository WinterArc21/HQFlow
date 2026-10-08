import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createPluginServer, PLUGIN_UI_URI } from "@server/plugin";
import { MAX_WORKFLOW_BYTES, savePluginWorkflow } from "@server/plugin-data";

const workflow = {
  schemaVersion: "0.1", id: "checkout", name: "Checkout", purpose: "Create an order.",
  entryPoint: { file: "src/checkout.ts", symbol: "checkout" },
  steps: [{ id: "start", name: "Start", purpose: "Create the order.", category: "entry", sources: [{ file: "src/checkout.ts", symbol: "checkout" }] }],
  connections: [],
};
let root: string;
let client: Client;
let server: ReturnType<typeof createPluginServer>;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "hqflow-plugin-"));
  await mkdir(path.join(root, ".codehq/workflows"), { recursive: true });
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src/checkout.ts"), "export function checkout() {}\n");
  await writeFile(path.join(root, ".codehq/project.json"), JSON.stringify({ schemaVersion: "0.1", project: { id: "fixture", name: "Fixture" } }));
  await writeFile(path.join(root, ".codehq/workflows/checkout.json"), JSON.stringify(workflow));
  server = createPluginServer({ root, html: "<!doctype html><div id='root'></div>", authoringGuide: "Verified sources only.", version: "test" });
  client = new Client({ name: "plugin-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
});
afterEach(async () => {
  await client?.close();
  await server?.close();
  await rm(root, { recursive: true, force: true });
});

describe("HQFlow plugin over MCP", () => {
  it("discovers sidebar/thread entrypoints, an offline UI and write annotations", async () => {
    const { tools } = await client.listTools();
    expect(tools.find((tool) => tool.name === "hqflow_open")?._meta).toMatchObject({
      ui: { resourceUri: PLUGIN_UI_URI }, "openai/ui": { entrypoints: [{ type: "global" }, { type: "thread" }] },
    });
    expect(tools.find((tool) => tool.name === "hqflow_save_workflow")?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    const resource = await client.readResource({ uri: PLUGIN_UI_URI });
    expect(resource.contents[0]).toMatchObject({ mimeType: "text/html;profile=mcp-app", text: expect.stringContaining("<!doctype html>") });
    const opened = await client.callTool({ name: "hqflow_open", arguments: {} });
    expect(opened.structuredContent).toMatchObject({ projectName: "Fixture", workflows: [{ id: "checkout" }] });
    expect(JSON.stringify(opened)).not.toContain(root);
  });

  it("searches workflow mentions and resolves their resource references", async () => {
    const matches = await client.callTool({ name: "search_mentions", arguments: { query: "order" } });
    expect(matches.structuredContent).toMatchObject({ items: [{ uri: "hqflow://workflows/checkout", title: "Checkout" }] });
    const content = await client.readResource({ uri: "hqflow://workflows/checkout" });
    expect(content.contents[0]).toMatchObject({ text: expect.stringContaining('"workflowId":"checkout"') });
    expect((await client.callTool({ name: "search_mentions", arguments: { query: "missing" } })).structuredContent).toEqual({ items: [] });
  });

  it("returns useful errors and reloads maps edited by another agent", async () => {
    expect((await client.callTool({ name: "hqflow_get_workflow", arguments: { id: "missing" } })).isError).toBe(true);
    await writeFile(path.join(root, ".codehq/workflows/checkout.json"), JSON.stringify({ ...workflow, name: "Updated checkout" }));
    expect((await client.callTool({ name: "hqflow_get_workflow", arguments: { id: "checkout" } })).structuredContent).toMatchObject({ payload: { workflowName: "Updated checkout", sourceChecks: { "src/checkout.ts#checkout": "found" } } });
    await writeFile(path.join(root, ".codehq/workflows/broken.json"), "{broken");
    const listed = await client.callTool({ name: "hqflow_list_workflows", arguments: {} });
    expect(listed.structuredContent).toMatchObject({ workflows: [{ id: "checkout" }], diagnostics: [{ severity: "error" }] });
  });

  it("saves validated maps, protects existing files, and supports requested replacement", async () => {
    const args = { workflowJson: JSON.stringify({ ...workflow, id: "new-map" }) };
    expect((await client.callTool({ name: "hqflow_save_workflow", arguments: args })).structuredContent).toMatchObject({ saved: true, file: ".codehq/workflows/new-map.json" });
    expect((await client.callTool({ name: "hqflow_save_workflow", arguments: args })).isError).toBe(true);
    expect((await client.callTool({ name: "hqflow_save_workflow", arguments: { ...args, overwrite: true } })).isError).not.toBe(true);
    expect(JSON.parse(await readFile(path.join(root, ".codehq/workflows/new-map.json"), "utf8"))).toMatchObject({ id: "new-map" });
    expect((await readdir(path.join(root, ".codehq/workflows"))).some((file) => file.endsWith(".tmp"))).toBe(false);
  });

  it("rejects invalid graphs, visual keys and traversing IDs before writing", async () => {
    for (const invalid of [
      { ...workflow, id: "../escape" },
      { ...workflow, id: "invalid", color: "red" },
      { ...workflow, id: "invalid", connections: [{ from: "start", to: "missing" }] },
    ]) {
      expect((await client.callTool({ name: "hqflow_save_workflow", arguments: { workflowJson: JSON.stringify(invalid) } })).isError).toBe(true);
    }
    expect(await readdir(path.join(root, ".codehq/workflows"))).toEqual(["checkout.json"]);
    await expect(savePluginWorkflow(root, " ".repeat(MAX_WORKFLOW_BYTES + 1))).rejects.toThrow("1 MiB");
  });

  it("rejects relative repository paths and saves into an uninitialized project", async () => {
    expect((await client.callTool({ name: "hqflow_select_repository", arguments: { root: "relative" } })).isError).toBe(true);
    await mkdir(path.join(root, "empty"));
    expect((await client.callTool({ name: "hqflow_select_repository", arguments: { root: path.join(root, "empty") } })).structuredContent).toMatchObject({ status: "uninitialized" });
    expect((await client.callTool({ name: "hqflow_save_workflow", arguments: { workflowJson: JSON.stringify(workflow) } })).isError).toBe(true);
  });

  it("allows only one concurrent creation of the same map", async () => {
    const attempts = await Promise.allSettled([0, 1].map(() => savePluginWorkflow(root, JSON.stringify({ ...workflow, id: "race" }))));
    expect(attempts.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((item) => item.status === "rejected")).toHaveLength(1);
  });

  it("rejects a workflow directory redirected into source through a junction", async () => {
    await rm(path.join(root, ".codehq/workflows"), { recursive: true });
    await symlink(path.join(root, "src"), path.join(root, ".codehq/workflows"), process.platform === "win32" ? "junction" : "dir");
    await expect(savePluginWorkflow(root, JSON.stringify(workflow), true)).rejects.toThrow("symlinks");
    expect(await readdir(path.join(root, "src"))).toEqual(["checkout.ts"]);
  });
});
