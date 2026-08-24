import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCodeHQServer, type CodeHQServer } from "@server/app";

const servers: CodeHQServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function createWorkflowRoot(fileName: string): { root: string; workflowFile: string } {
  const root = mkdtempSync(path.join(tmpdir(), "codehq-delete-workflow-"));
  const workflowsDir = path.join(root, ".codehq", "workflows");
  mkdirSync(workflowsDir, { recursive: true });
  writeFileSync(
    path.join(root, ".codehq", "project.json"),
    JSON.stringify({ schemaVersion: "0.1", project: { id: "delete-test", name: "Delete Test" } }),
  );
  const workflowFile = path.join(workflowsDir, fileName);
  writeFileSync(
    workflowFile,
    JSON.stringify({
      schemaVersion: "0.1",
      id: "sample",
      name: "Sample workflow",
      purpose: "A workflow used by the deletion tests.",
      steps: [{ id: "step-1", name: "Step 1", purpose: "Does the thing.", category: "entry" }],
      connections: [],
    }),
  );
  return { root, workflowFile };
}

async function startServer(root: string): Promise<CodeHQServer> {
  const server = await createCodeHQServer({ root, port: 0, serveWeb: false });
  servers.push(server);
  return server;
}

describe("DELETE /api/workflows/:id", () => {
  it("unlinks the exact loaded workflow file and returns the refreshed store snapshot", async () => {
    const { root, workflowFile } = createWorkflowRoot("renamed.json");
    try {
      const server = await startServer(root);

      const response = await fetch(`${server.url}/api/workflows/sample`, { method: "DELETE" });
      expect(response.status).toBe(200);

      const snapshot = (await response.json()) as { status: string; workflows: unknown[] };
      expect(snapshot.status).toBe("empty");
      expect(snapshot.workflows).toHaveLength(0);
      expect(existsSync(workflowFile)).toBe(false);
      expect(server.store.getSnapshot().workflows).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a stale workflow and leaves its file and store state intact", async () => {
    const { root, workflowFile } = createWorkflowRoot("sample.json");
    try {
      const server = await startServer(root);
      writeFileSync(
        workflowFile,
        JSON.stringify({
          schemaVersion: "0.1",
          id: "sample",
          name: "Sample workflow",
          purpose: "A workflow used by the deletion tests.",
        }),
      );
      await server.store.reload();

      const response = await fetch(`${server.url}/api/workflows/sample`, { method: "DELETE" });
      expect(response.status).toBe(409);
      expect((await response.text()).toLowerCase()).toContain("valid");
      expect(existsSync(workflowFile)).toBe(true);
      expect(server.store.getSnapshot().workflows).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
