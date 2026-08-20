import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCodeHQServer, type CodeHQServer } from "@server/app";

interface FolderDto {
  id: string;
  name: string;
  workflowIds: string[];
}

const servers: CodeHQServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function createProjectRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "codehq-folders-"));
  mkdirSync(path.join(root, ".codehq", "workflows"), { recursive: true });
  writeFileSync(
    path.join(root, ".codehq", "project.json"),
    JSON.stringify({ schemaVersion: "0.1", project: { id: "folders-test", name: "Folders Test" } }),
  );
  return root;
}

function addWorkflow(root: string, id: string): void {
  writeFileSync(
    path.join(root, ".codehq", "workflows", `${id}.json`),
    JSON.stringify({
      schemaVersion: "0.1",
      id,
      name: id,
      purpose: `Purpose for ${id}.`,
      steps: [{ id: "step-1", name: "Step 1", purpose: "Does something." }],
      connections: [],
    }),
  );
}

async function startServer(root: string): Promise<CodeHQServer> {
  const server = await createCodeHQServer({ root, port: 0, serveWeb: false });
  servers.push(server);
  return server;
}

async function createFolderViaApi(server: CodeHQServer, name: string): Promise<FolderDto> {
  const response = await fetch(`${server.url}/api/folders`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return (await response.json()) as FolderDto;
}

async function assignViaApi(server: CodeHQServer, workflowId: string, folderId: string | null): Promise<Response> {
  return fetch(`${server.url}/api/workflows/${workflowId}/folder`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ folderId }),
  });
}

describe("GET /api/folders", () => {
  it("returns an empty folder list when nothing has been saved", async () => {
    const root = createProjectRoot();
    try {
      const server = await startServer(root);

      const response = await fetch(`${server.url}/api/folders`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ folders: [] });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("POST /api/folders", () => {
  it("creates a folder with the given name and no workflows, and returns it", async () => {
    const root = createProjectRoot();
    try {
      const server = await startServer(root);

      const response = await fetch(`${server.url}/api/folders`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Payments" }),
      });
      expect(response.status).toBe(201);
      const folder = (await response.json()) as FolderDto;
      expect(folder.name).toBe("Payments");
      expect(folder.id).toBeTruthy();
      expect(folder.workflowIds).toEqual([]);

      const listResponse = await fetch(`${server.url}/api/folders`);
      expect(await listResponse.json()).toEqual({ folders: [folder] });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a body without a name", async () => {
    const root = createProjectRoot();
    try {
      const server = await startServer(root);

      const response = await fetch(`${server.url}/api/folders`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(response.status).toBe(400);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("PATCH /api/folders/:id", () => {
  it("renames an existing folder", async () => {
    const root = createProjectRoot();
    try {
      const server = await startServer(root);
      const folder = await createFolderViaApi(server, "Payments");

      const response = await fetch(`${server.url}/api/folders/${folder.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Billing" }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ id: folder.id, name: "Billing", workflowIds: [] });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("404s for an unknown folder id", async () => {
    const root = createProjectRoot();
    try {
      const server = await startServer(root);

      const response = await fetch(`${server.url}/api/folders/does-not-exist`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Billing" }),
      });
      expect(response.status).toBe(404);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("PUT /api/workflows/:id/folder", () => {
  it("appends a workflow to a folder's workflowIds", async () => {
    const root = createProjectRoot();
    try {
      addWorkflow(root, "checkout");
      const server = await startServer(root);
      const folder = await createFolderViaApi(server, "Payments");

      const response = await assignViaApi(server, "checkout", folder.id);
      expect(response.status).toBe(204);

      const listResponse = await fetch(`${server.url}/api/folders`);
      expect(await listResponse.json()).toEqual({ folders: [{ ...folder, workflowIds: ["checkout"] }] });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("unassigns a workflow when folderId is null", async () => {
    const root = createProjectRoot();
    try {
      addWorkflow(root, "checkout");
      const server = await startServer(root);
      const folder = await createFolderViaApi(server, "Payments");
      await assignViaApi(server, "checkout", folder.id);

      const response = await assignViaApi(server, "checkout", null);
      expect(response.status).toBe(204);

      const listResponse = await fetch(`${server.url}/api/folders`);
      expect(await listResponse.json()).toEqual({ folders: [folder] });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a body without a folderId key", async () => {
    const root = createProjectRoot();
    try {
      addWorkflow(root, "checkout");
      const server = await startServer(root);

      const response = await fetch(`${server.url}/api/workflows/checkout/folder`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(response.status).toBe(400);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("404s for an unknown workflow id", async () => {
    const root = createProjectRoot();
    try {
      const server = await startServer(root);

      const response = await fetch(`${server.url}/api/workflows/does-not-exist/folder`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ folderId: null }),
      });
      expect(response.status).toBe(404);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("404s for an unknown folder id", async () => {
    const root = createProjectRoot();
    try {
      addWorkflow(root, "checkout");
      const server = await startServer(root);

      const response = await assignViaApi(server, "checkout", "does-not-exist");
      expect(response.status).toBe(404);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("DELETE /api/folders/:id", () => {
  it("deletes the folder and unassigns any workflows that were in it", async () => {
    const root = createProjectRoot();
    try {
      addWorkflow(root, "checkout");
      const server = await startServer(root);
      const folder = await createFolderViaApi(server, "Payments");
      await assignViaApi(server, "checkout", folder.id);

      const response = await fetch(`${server.url}/api/folders/${folder.id}`, { method: "DELETE" });
      expect(response.status).toBe(204);

      const listResponse = await fetch(`${server.url}/api/folders`);
      expect(await listResponse.json()).toEqual({ folders: [] });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("PUT /api/folders/:id/order", () => {
  it("replaces the folder's workflow order", async () => {
    const root = createProjectRoot();
    try {
      addWorkflow(root, "checkout");
      addWorkflow(root, "refund");
      const server = await startServer(root);
      const folder = await createFolderViaApi(server, "Payments");
      await assignViaApi(server, "checkout", folder.id);
      await assignViaApi(server, "refund", folder.id);

      const response = await fetch(`${server.url}/api/folders/${folder.id}/order`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workflowIds: ["refund", "checkout"] }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ...folder, workflowIds: ["refund", "checkout"] });

      const listResponse = await fetch(`${server.url}/api/folders`);
      expect(await listResponse.json()).toEqual({ folders: [{ ...folder, workflowIds: ["refund", "checkout"] }] });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects an order that doesn't contain exactly the folder's current members", async () => {
    const root = createProjectRoot();
    try {
      addWorkflow(root, "checkout");
      const server = await startServer(root);
      const folder = await createFolderViaApi(server, "Payments");
      await assignViaApi(server, "checkout", folder.id);

      const response = await fetch(`${server.url}/api/folders/${folder.id}/order`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workflowIds: ["checkout", "refund"] }),
      });
      expect(response.status).toBe(400);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a body without a workflowIds array", async () => {
    const root = createProjectRoot();
    try {
      const server = await startServer(root);
      const folder = await createFolderViaApi(server, "Payments");

      const response = await fetch(`${server.url}/api/folders/${folder.id}/order`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(response.status).toBe(400);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
