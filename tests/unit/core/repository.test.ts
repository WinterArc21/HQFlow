import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { codeHQPaths, repositoryName, resolveRepositoryRoot } from "@core/repository";

let base: string;

beforeEach(() => {
  base = mkdtempSync(path.join(tmpdir(), "codehq-repo-root-"));
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("resolveRepositoryRoot", () => {
  it("prefers a nearer .git over a farther .codehq when .codehq is absent", () => {
    mkdirSync(path.join(base, ".git"));
    const startDir = path.join(base, "src", "deep");
    mkdirSync(startDir, { recursive: true });

    expect(resolveRepositoryRoot(startDir)).toBe(base);
  });

  it("prefers .codehq over a closer .git", () => {
    // .codehq sits at `base`, but `.git` sits closer, at `base/mid`.
    mkdirSync(path.join(base, ".codehq"));
    const midDir = path.join(base, "mid");
    mkdirSync(path.join(midDir, ".git"), { recursive: true });
    const startDir = path.join(midDir, "src");
    mkdirSync(startDir, { recursive: true });

    expect(resolveRepositoryRoot(startDir)).toBe(base);
  });

  it("falls back to the nearest package.json when neither .codehq nor .git exist", () => {
    writeFileSync(path.join(base, "package.json"), "{}");
    const startDir = path.join(base, "src");
    mkdirSync(startDir, { recursive: true });

    expect(resolveRepositoryRoot(startDir)).toBe(base);
  });

  it("falls back to startDir itself when no marker exists anywhere up to the filesystem root", () => {
    const startDir = path.join(base, "src", "deep");
    mkdirSync(startDir, { recursive: true });

    // No .codehq, .git, or package.json anywhere above `startDir` inside our
    // isolated temp tree, so it must fall back to `startDir`.
    expect(resolveRepositoryRoot(startDir)).toBe(path.resolve(startDir));
  });

  it("terminates instead of looping forever at the filesystem root", () => {
    const root = path.parse(base).root;
    expect(() => resolveRepositoryRoot(root)).not.toThrow();
    expect(resolveRepositoryRoot(root)).toBe(root);
  });
});

describe("repositoryName", () => {
  it("prefers .codehq/project.json's project.name", () => {
    mkdirSync(path.join(base, ".codehq"));
    writeFileSync(
      path.join(base, ".codehq", "project.json"),
      JSON.stringify({ schemaVersion: "0.1", project: { id: "x", name: "From Project Json" } }),
    );
    writeFileSync(path.join(base, "package.json"), JSON.stringify({ name: "from-package-json" }));

    expect(repositoryName(base)).toBe("From Project Json");
  });

  it("falls back to package.json's name when project.json is absent", () => {
    writeFileSync(path.join(base, "package.json"), JSON.stringify({ name: "from-package-json" }));

    expect(repositoryName(base)).toBe("from-package-json");
  });

  it("falls back to the directory basename when nothing else is available", () => {
    expect(repositoryName(base)).toBe(path.basename(base));
  });

  it("does not throw on a malformed project.json and falls through to the next source", () => {
    mkdirSync(path.join(base, ".codehq"));
    writeFileSync(path.join(base, ".codehq", "project.json"), "{ not valid json");
    writeFileSync(path.join(base, "package.json"), JSON.stringify({ name: "fallback-name" }));

    expect(repositoryName(base)).toBe("fallback-name");
  });

  it("uses validated project data without reparsing project.json", () => {
    mkdirSync(path.join(base, ".codehq"));
    writeFileSync(path.join(base, ".codehq", "project.json"), "{ not valid json");

    expect(
      repositoryName(base, {
        schemaVersion: "0.1",
        project: { id: "validated", name: "Validated Project" },
      }),
    ).toBe("Validated Project");
  });

  it("uses the documented fallback when validated project data is absent", () => {
    mkdirSync(path.join(base, ".codehq"));
    writeFileSync(path.join(base, ".codehq", "project.json"), JSON.stringify({ project: { name: "Unvalidated Name" } }));
    writeFileSync(path.join(base, "package.json"), JSON.stringify({ name: "fallback-name" }));

    expect(repositoryName(base, null)).toBe("fallback-name");
  });
});

describe("codeHQPaths", () => {
  it("derives every canonical path from the root", () => {
    const paths = codeHQPaths(base);
    expect(paths.dir).toBe(path.join(base, ".codehq"));
    expect(paths.projectFile).toBe(path.join(base, ".codehq", "project.json"));
    expect(paths.workflowsDir).toBe(path.join(base, ".codehq", "workflows"));
    expect(paths.diagnosticsFile).toBe(path.join(base, ".codehq", "diagnostics.json"));
    expect(paths.skillFile).toBe(path.join(base, ".codehq", "SKILL.md"));
    expect(paths.runtimeDir).toBe(path.join(base, ".codehq", ".runtime"));
  });
});
