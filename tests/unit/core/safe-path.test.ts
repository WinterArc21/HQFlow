import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveInsideRepository } from "@core/safe-path";

let root: string;
let siblingDir: string;
let canSymlink = false;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "codehq-safe-path-"));
  mkdirSync(path.join(root, "src"), { recursive: true });
  mkdirSync(path.join(root, "a", "b"), { recursive: true });
  writeFileSync(path.join(root, "src", "index.ts"), "export {};\n");
  writeFileSync(path.join(root, "a", "b", "c.ts"), "export {};\n");

  // A sibling directory whose name shares a prefix with `root` — the classic
  // `resolved.startsWith(root)` bug would treat `<root>-evil` as "inside" `root`.
  siblingDir = `${root}-evil`;
  mkdirSync(siblingDir, { recursive: true });
  writeFileSync(path.join(siblingDir, "secret.ts"), "export {};\n");

  try {
    symlinkSync(siblingDir, path.join(root, "escape-link"), "dir");
    canSymlink = true;
  } catch {
    canSymlink = false;
  }
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(siblingDir, { recursive: true, force: true });
});

describe("resolveInsideRepository — rejects unsafe input", () => {
  it.each([
    ["a '..' segment", "../etc/passwd"],
    ["a backslash '..' traversal", "..\\..\\x"],
    ["a leading-slash absolute path", "/abs/path"],
    ["a Windows drive-letter path", "C:\\Windows\\x"],
    ["a UNC path", "\\\\server\\share"],
    ["a '..' segment buried in the middle", "foo/../../bar"],
    ["an empty path", ""],
    ["a NUL byte", "foo\0bar.ts"],
  ])("rejects %s", (_label, input) => {
    expect(resolveInsideRepository(root, input).ok).toBe(false);
  });

  it("never uses a bare prefix check: a sibling directory sharing a name prefix is not 'inside'", () => {
    // Even though describePathProblem already rejects any literal ".." segment, this
    // guards the containment check itself: `resolved.startsWith(root)` alone (without a
    // trailing separator) would wrongly accept "<root>-evil/...".
    const result = resolveInsideRepository(root, "sibling-check.ts");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.absolutePath.startsWith(siblingDir)).toBe(false);
    }
  });

  it("rejects a symlinked directory that escapes the repository root", (context) => {
    // `canSymlink` is only known after beforeAll runs, so the skip must happen inside the test.
    if (!canSymlink) {
      context.skip();
    }
    const result = resolveInsideRepository(root, "escape-link/secret.ts");
    expect(result.ok).toBe(false);
  });
});

describe("resolveInsideRepository — accepts legitimate nested paths", () => {
  it("accepts an existing nested file", () => {
    const result = resolveInsideRepository(root, "src/index.ts");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(path.basename(result.absolutePath)).toBe("index.ts");
    }
  });

  it("accepts a deeper existing nested file", () => {
    const result = resolveInsideRepository(root, "a/b/c.ts");
    expect(result.ok).toBe(true);
  });

  it("accepts a nested path that does not exist yet, as long as its parent does", () => {
    const result = resolveInsideRepository(root, "src/not-created-yet.ts");
    expect(result.ok).toBe(true);
  });

  it("accepts backslash-separated relative paths", () => {
    const result = resolveInsideRepository(root, "a\\b\\c.ts");
    expect(result.ok).toBe(true);
  });

  it("accepts the root itself via '.'", () => {
    const result = resolveInsideRepository(root, ".");
    expect(result.ok).toBe(true);
  });
});
