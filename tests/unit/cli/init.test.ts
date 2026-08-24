import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseProject } from "@schema/validate";
import { runInit } from "../../../src/cli/commands/init";

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "codehq-cli-init-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const PROJECT_FILE = ".codehq/project.json";
const SKILL_FILE = ".codehq/SKILL.md";
const WORKFLOWS_DIR = ".codehq/workflows";
const DIAGNOSTICS_FILE = ".codehq/diagnostics.json";

function abs(relative: string): string {
  return path.join(root, ...relative.split("/"));
}

describe("runInit — fresh repository", () => {
  it("creates the expected tree with an empty workflows/ and a parseable project.json", async () => {
    const result = await runInit({ root });

    expect(result.exitCode).toBe(0);
    expect(existsSync(abs(PROJECT_FILE))).toBe(true);
    expect(existsSync(abs(SKILL_FILE))).toBe(true);
    expect(existsSync(abs(WORKFLOWS_DIR))).toBe(true);
    expect(existsSync(abs(DIAGNOSTICS_FILE))).toBe(true);
    expect(result.created).toEqual([".codehq/project.json", ".codehq/workflows/", ".codehq/SKILL.md"]);
    expect(result.unchanged).toEqual([]);

    const projectJson = JSON.parse(readFileSync(abs(PROJECT_FILE), "utf-8")) as unknown;
    const projectResult = parseProject(projectJson, PROJECT_FILE);
    expect(projectResult.ok).toBe(true);

    const diagnostics = JSON.parse(readFileSync(abs(DIAGNOSTICS_FILE), "utf-8")) as { valid: boolean; issues: unknown[] };
    expect(diagnostics.valid).toBe(true);
    expect(diagnostics.issues).toEqual([]);
  });

  it("appends .codehq/.runtime/ to .gitignore exactly once, and never duplicates it on rerun", async () => {
    await runInit({ root });
    const firstContent = readFileSync(path.join(root, ".gitignore"), "utf-8");
    expect(firstContent).toContain(".codehq/.runtime/");

    await runInit({ root });
    const secondContent = readFileSync(path.join(root, ".gitignore"), "utf-8");
    const occurrences = secondContent.split(".codehq/.runtime/").length - 1;
    expect(occurrences).toBe(1);
  });

  it("handles an existing .gitignore with no trailing newline", async () => {
    writeFileSync(path.join(root, ".gitignore"), "node_modules");
    await runInit({ root });
    const content = readFileSync(path.join(root, ".gitignore"), "utf-8");
    expect(content).toBe("node_modules\n.codehq/.runtime/\n");
  });

  it("never duplicates an equivalent pre-existing ignore pattern", async () => {
    writeFileSync(path.join(root, ".gitignore"), "/.codehq/.runtime\n");
    await runInit({ root });
    const content = readFileSync(path.join(root, ".gitignore"), "utf-8");
    expect(content).toBe("/.codehq/.runtime\n");
  });
});

describe("runInit — idempotency", () => {
  it("leaves a human-edited SKILL.md byte-identical on rerun, and reports it unchanged", async () => {
    await runInit({ root });
    const editedContent = "# My custom skill notes\n\nDo not touch this.\n";
    writeFileSync(abs(SKILL_FILE), editedContent, "utf-8");

    const secondResult = await runInit({ root });

    expect(readFileSync(abs(SKILL_FILE), "utf-8")).toBe(editedContent);
    expect(secondResult.unchanged).toContain(SKILL_FILE);
    expect(secondResult.created).not.toContain(SKILL_FILE);
  });
});

describe("runInit — --force", () => {
  it("overwrites a previously edited SKILL.md", async () => {
    await runInit({ root });
    writeFileSync(abs(SKILL_FILE), "custom content that should be replaced\n", "utf-8");

    const result = await runInit({ root, force: true });

    expect(readFileSync(abs(SKILL_FILE), "utf-8")).not.toBe("custom content that should be replaced\n");
    expect(result.created).toContain(SKILL_FILE);
    expect(result.unchanged).not.toContain(SKILL_FILE);
  });
});

describe("runInit — non-project-root warning", () => {
  it("warns when the target has neither .git nor package.json", async () => {
    const result = await runInit({ root });
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("does not warn when a .git directory is present", async () => {
    const gitRoot = mkdtempSync(path.join(tmpdir(), "codehq-cli-init-git-"));
    try {
      const fs = await import("node:fs");
      fs.mkdirSync(path.join(gitRoot, ".git"));
      const result = await runInit({ root: gitRoot });
      expect(result.warnings).toEqual([]);
    } finally {
      rmSync(gitRoot, { recursive: true, force: true });
    }
  });
});
