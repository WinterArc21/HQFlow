/**
 * Exercises the built CLI (`dist/node/cli.js`) the way a user would, in disposable temp
 * directories.
 *
 * On the Windows SIGINT question: see the "open" test below and its comments. Short version —
 * confirmed by direct experiment (not just asserted here) that a Node parent process on
 * Windows cannot deliver a real signal to a spawned child: `child.kill('SIGINT')`
 * force-terminates the child without its own `process.on('SIGINT')` handler ever running, and
 * `taskkill /pid <pid>` (no `/F`) outright refuses with "This process can only be terminated
 * forcefully". Playwright's own `webServer` plugin encodes the same limitation: its graceful
 * shutdown path throws `"Graceful shutdown is not supported on Windows"` unconditionally. So
 * this suite proves what IS true end-to-end from a spawned process — it starts, serves, and on
 * termination releases its port — and does not claim to have exercised `runOpen`'s in-app
 * graceful-shutdown code path (`waitForStopSignal` printing "Stopped." and awaiting
 * `server.close()`), because that would not be a real result.
 */
import { promises as fsp } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { createEmptyTempDir, removeTempDir } from "./helpers/fixture";
import { runCli } from "./helpers/cli";
import { PORTS, SOURCE_FIXTURE_DIR } from "./helpers/paths";
import { startCodeHQServer, waitForPortFree } from "./helpers/server";

async function fileExists(target: string): Promise<boolean> {
  try {
    await fsp.stat(target);
    return true;
  } catch {
    return false;
  }
}

interface MinimalWorkflowFile {
  connections: Array<{ from: string; to: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

test("init creates the documented tree and prints the documented banner", async () => {
  const dir = await createEmptyTempDir("cli-init");
  try {
    const result = await runCli(["init"], { cwd: dir });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("HQFlow initialized.");
    expect(result.stdout).toContain("Created:");
    expect(result.stdout).toContain(".codehq/project.json");
    expect(result.stdout).toContain(".codehq/workflows/");
    expect(result.stdout).toContain(".codehq/SKILL.md");
    expect(result.stdout).toContain("Next:");
    expect(result.stdout).toContain("hqflow open");

    expect(await fileExists(path.join(dir, ".codehq", "project.json"))).toBe(true);
    expect(await fileExists(path.join(dir, ".codehq", "SKILL.md"))).toBe(true);
    expect(await fileExists(path.join(dir, ".codehq", "diagnostics.json"))).toBe(true);
    expect(await fileExists(path.join(dir, ".codehq", "workflows", "generate-video.json"))).toBe(false);

    const gitignore = await fsp.readFile(path.join(dir, ".gitignore"), "utf-8");
    expect(gitignore).toContain(".codehq/.runtime/");
  } finally {
    await removeTempDir(dir);
  }
});

test("validate exits 0 on a fresh project, then exits 1 naming the step a broken connection points at", async () => {
  const dir = await createEmptyTempDir("cli-validate");
  try {
    const initResult = await runCli(["init"], { cwd: dir });
    expect(initResult.exitCode).toBe(0);

    const workflowFile = path.join(dir, ".codehq", "workflows", "generate-video.json");
    await fsp.copyFile(path.join(SOURCE_FIXTURE_DIR, ".codehq", "workflows", "generate-video.json"), workflowFile);

    const freshValidate = await runCli(["validate", "--root", dir]);
    expect(freshValidate.exitCode).toBe(0);
    // A bare temp dir has none of the source files the test workflow references, so this
    // is "0 errors, N warnings" rather than a silent "all valid" — genuinely exercising the
    // exit-code-vs-severity distinction (errors fail validate, warnings do not) rather than a
    // trivial, warning-free happy path.
    expect(freshValidate.stdout).toContain("0 errors");

    const workflow = JSON.parse(await fsp.readFile(workflowFile, "utf-8")) as MinimalWorkflowFile;
    const target = workflow.connections.find((connection) => connection.to === "generate-story");
    if (target === undefined) {
      throw new Error("Fixture changed: expected a connection pointing at 'generate-story'.");
    }
    target.to = "generate-story-missing";
    await fsp.writeFile(workflowFile, `${JSON.stringify(workflow, null, 2)}\n`, "utf-8");

    const brokenValidate = await runCli(["validate", "--root", dir]);
    expect(brokenValidate.exitCode).toBe(1);
    expect(brokenValidate.stdout).toContain("Connection references missing step 'generate-story-missing'.");

    const jsonValidate = await runCli(["validate", "--root", dir, "--json"]);
    expect(jsonValidate.exitCode).toBe(1);
    const parsed = JSON.parse(jsonValidate.stdout.trim()) as { valid: boolean; issues: unknown[] };
    expect(parsed.valid).toBe(false);
    expect(Array.isArray(parsed.issues)).toBe(true);
    expect(
      parsed.issues.some(
        (issue) =>
          typeof issue === "object" &&
          issue !== null &&
          "message" in issue &&
          (issue as { message: unknown }).message === "Connection references missing step 'generate-story-missing'.",
      ),
    ).toBe(true);
  } finally {
    await removeTempDir(dir);
  }
});

test("open starts the real server and serving stops (and the port is released) when the process is terminated", async () => {
  const dir = await createEmptyTempDir("cli-open");
  try {
    const initResult = await runCli(["init"], { cwd: dir });
    expect(initResult.exitCode).toBe(0);
    await fsp.copyFile(
      path.join(SOURCE_FIXTURE_DIR, ".codehq", "workflows", "generate-video.json"),
      path.join(dir, ".codehq", "workflows", "generate-video.json"),
    );

    const server = await startCodeHQServer(dir, PORTS.cliOpen);
    expect(server.stdout()).toContain("HQFlow is running.");

    const stateResponse = await fetch(`${server.url}/api/state`);
    expect(stateResponse.ok).toBe(true);
    const snapshot = (await stateResponse.json()) as { status: string };
    expect(snapshot.status).toBe("ready");

    await server.stop();
    await waitForPortFree(PORTS.cliOpen);
  } finally {
    await removeTempDir(dir);
  }
});
