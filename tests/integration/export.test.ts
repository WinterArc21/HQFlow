import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createCodeHQServer, type CodeHQServer } from "@server/app";

let root: string;
let server: CodeHQServer | null = null;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "codehq-export-"));
  const workflowsDir = path.join(root, ".codehq", "workflows");
  mkdirSync(workflowsDir, { recursive: true });
  writeFileSync(path.join(root, "real-source.ts"), "export function realFunction() {}\n");
  writeFileSync(
    path.join(root, ".codehq", "project.json"),
    JSON.stringify({
      schemaVersion: "0.1",
      project: { id: "fixture", name: "Fixture Project" },
      settings: { defaultWorkflowId: "sample" },
    }),
  );
  writeFileSync(
    path.join(workflowsDir, "sample.json"),
    JSON.stringify({
      schemaVersion: "0.1",
      id: "sample",
      name: "Sample",
      purpose: "A sample workflow.",
      entryPoint: { file: "real-source.ts", symbol: "realFunction" },
      steps: [
        {
          id: "step-1",
          name: "Step 1",
          purpose: "Does the thing.",
          category: "entry",
          sources: [{ file: "real-source.ts", symbol: "realFunction" }],
        },
      ],
      connections: [],
    }),
  );
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

afterEach(async () => {
  if (server !== null) {
    await server.close();
    server = null;
  }
});

async function startServer(): Promise<CodeHQServer> {
  server = await createCodeHQServer({ root, port: 0, serveWeb: false });
  return server;
}

describe("GET /api/export/:id", () => {
  it("returns 404 for an unknown workflow id", async () => {
    const running = await startServer();
    const response = await fetch(`${running.url}/api/export/does-not-exist`);
    expect(response.status).toBe(404);
  });

  it("returns an HTML attachment without machine-local data", async () => {
    const running = await startServer();
    const response = await fetch(`${running.url}/api/export/sample`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");

    const disposition = response.headers.get("content-disposition");
    expect(disposition).toContain("attachment");
    expect(disposition).toContain(".html");

    const html = await response.text();
    expect(html).toContain("real-source.ts");

    // Machine-local data stripped.
    expect(html).not.toContain(root);
    expect(html).not.toContain(".codehq/workflows/sample.json");
    expect(html).not.toContain("absolutePath");
    expect(html).not.toContain("codeHQDir");
  });

  it("defaults hideFilePaths to false and rejects malformed or unknown export queries", async () => {
    const running = await startServer();
    const defaultResponse = await fetch(`${running.url}/api/export/sample`);
    expect(defaultResponse.status).toBe(200);
    expect(await defaultResponse.text()).toContain('"hideFilePaths":false');

    const malformed = await fetch(`${running.url}/api/export/sample?hideFilePaths=maybe`);
    expect(malformed.status).toBe(400);

    const unknown = await fetch(`${running.url}/api/export/sample?hideFilePaths=false&extra=1`);
    expect(unknown.status).toBe(400);
  });
});
