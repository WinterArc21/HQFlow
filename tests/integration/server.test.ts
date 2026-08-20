import { createServer } from "node:net";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createCodeHQServer, findAvailablePort, type CodeHQServer } from "@server/app";

let root: string;
let server: CodeHQServer | null = null;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "codehq-server-"));
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
  server = await createCodeHQServer({
    root,
    port: 0,
    serveWeb: false,
  });
  return server;
}

describe("createCodeHQServer — endpoint shapes", () => {
  it("GET /api/state returns the full snapshot", async () => {
    const running = await startServer();
    const response = await fetch(`${running.url}/api/state`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; workflows: unknown[]; project: unknown };
    expect(body.status).toBe("ready");
    expect(body.workflows).toHaveLength(1);
    expect(body.project).not.toBeNull();
  });

  it("GET /api/project returns the project", async () => {
    const running = await startServer();
    const response = await fetch(`${running.url}/api/project`);
    const body = (await response.json()) as { project: { id: string } } | { id: string };
    expect(JSON.stringify(body)).toContain("fixture");
  });

  it("GET /api/workflows returns the workflow list", async () => {
    const running = await startServer();
    const response = await fetch(`${running.url}/api/workflows`);
    const body = (await response.json()) as Array<{ id: string; state: string }>;
    expect(body).toHaveLength(1);
    expect(body[0]?.id).toBe("sample");
    expect(body[0]?.state).toBe("valid");
  });

  it("GET /api/workflows/:id returns 200 for a known id and 404 for an unknown one", async () => {
    const running = await startServer();
    const ok = await fetch(`${running.url}/api/workflows/sample`);
    expect(ok.status).toBe(200);

    const missing = await fetch(`${running.url}/api/workflows/does-not-exist`);
    expect(missing.status).toBe(404);
  });

  it("GET /api/diagnostics returns a valid, error-free report", async () => {
    const running = await startServer();
    const response = await fetch(`${running.url}/api/diagnostics`);
    const body = (await response.json()) as { valid: boolean; issues: unknown[] };
    expect(body.valid).toBe(true);
  });

  it("POST /api/recheck forces a reload and returns the fresh snapshot", async () => {
    const running = await startServer();
    const response = await fetch(`${running.url}/api/recheck`, { method: "POST" });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { generatedAt: string };
    expect(typeof body.generatedAt).toBe("string");
  });

  it("does not expose the removed folder/reveal endpoint", async () => {
    const running = await startServer();
    const response = await fetch(`${running.url}/api/reveal`, { method: "POST" });
    expect(response.status).toBe(404);
  });
});

describe("createCodeHQServer — /api/workflows/:id/layout", () => {
  it("GET returns 404 for an unknown workflow", async () => {
    const running = await startServer();
    const response = await fetch(`${running.url}/api/workflows/does-not-exist/layout`);
    expect(response.status).toBe(404);
  });

  it("GET returns an empty positions map before anything has been saved", async () => {
    const running = await startServer();
    const response = await fetch(`${running.url}/api/workflows/sample/layout`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { positions: Record<string, { x: number; y: number }> };
    expect(body.positions).toEqual({});
  });

  it("PUT saves positions, and a subsequent GET returns them", async () => {
    const running = await startServer();
    const put = await fetch(`${running.url}/api/workflows/sample/layout`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ "step-1": { x: 120, y: 340 } }),
    });
    expect(put.status).toBe(204);

    const get = await fetch(`${running.url}/api/workflows/sample/layout`);
    const body = (await get.json()) as { positions: Record<string, { x: number; y: number }> };
    expect(body.positions).toEqual({ "step-1": { x: 120, y: 340 } });
  });

  it("PUT rejects a malformed body with 400", async () => {
    const running = await startServer();
    const response = await fetch(`${running.url}/api/workflows/sample/layout`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ "step-1": { x: "not-a-number", y: 0 } }),
    });
    expect(response.status).toBe(400);
  });

  it("PUT returns 404 for an unknown workflow", async () => {
    const running = await startServer();
    const response = await fetch(`${running.url}/api/workflows/does-not-exist/layout`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(404);
  });
});

describe("createCodeHQServer — /api/source", () => {
  it("returns metadata only, and never file contents, for a real file", async () => {
    const running = await startServer();
    const response = await fetch(`${running.url}/api/source?file=real-source.ts&line=1`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { file: string; exists: boolean; editorUrl: string; absolutePath: string };
    expect(body.exists).toBe(true);
    expect(body.editorUrl).toMatch(/^vscode:\/\/file\//);
    expect(body.editorUrl).toContain(":1");
    expect(JSON.stringify(body)).not.toContain("realFunction() {}");
  });

  it("rejects a traversal attempt with 400", async () => {
    const running = await startServer();
    const response = await fetch(`${running.url}/api/source?file=${encodeURIComponent("../../etc/passwd")}`);
    expect(response.status).toBe(400);
    const body = (await response.text()) as string;
    expect(body).not.toContain("root:");
  });

  it("rejects an absolute path with 400", async () => {
    const running = await startServer();
    const response = await fetch(`${running.url}/api/source?file=${encodeURIComponent("/etc/passwd")}`);
    expect(response.status).toBe(400);
  });

  it("rejects an unknown query parameter with 400", async () => {
    const running = await startServer();
    const response = await fetch(`${running.url}/api/source?file=real-source.ts&bogus=1`);
    expect(response.status).toBe(400);
  });
});

describe("findAvailablePort", () => {
  it("skips a port that is already bound", async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
    const address = blocker.address();
    const blockedPort = typeof address === "object" && address !== null ? address.port : 0;

    try {
      const found = await findAvailablePort(blockedPort, "127.0.0.1", 5);
      expect(found).not.toBe(blockedPort);
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });
});

describe("createCodeHQServer — lifecycle", () => {
  it("closes cleanly", async () => {
    const running = await startServer();
    await expect(running.close()).resolves.toBeUndefined();
    server = null;
  });

  it("never binds 0.0.0.0", async () => {
    await expect(createCodeHQServer({ root, host: "0.0.0.0" })).rejects.toThrow(/0\.0\.0\.0/);
  });
});
