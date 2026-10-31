/**
 * Exercises the built CLI (`dist/node/cli.js`) `open` command in a disposable temp directory.
 *
 * On the Windows SIGINT question: see the test below. Short version —
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
