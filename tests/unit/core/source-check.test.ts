import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkSourceReference, computeWorkflowSourceChecks } from "@core/source-check";
import { parseWorkflow } from "@schema/validate";

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "codehq-source-check-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(relPath: string, contents: string): void {
  const absolute = path.join(root, relPath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents);
}

describe("checkSourceReference", () => {
  it("marks absent files and repository escapes as missing", () => {
    expect(checkSourceReference(root, { file: "does/not/exist.ts" })).toBe("missing");
    expect(checkSourceReference(root, { file: "../outside.ts" })).toBe("missing");
  });

  it("marks an existing file as found, even when a symbol is attached", () => {
    write("lib/thing.ts", "export function thing() {}\n");
    expect(checkSourceReference(root, { file: "lib/thing.ts" })).toBe("found");
    expect(checkSourceReference(root, { file: "lib/thing.ts", symbol: "missingSymbol" })).toBe("found");
    write("README.md", "## thing\n");
    expect(checkSourceReference(root, { file: "README.md", symbol: "thing" })).toBe("found");
  });

  it("re-reads a file after it is deleted", () => {
    write("lib/thing.ts", "export function doThing() { return 1; }\n");
    expect(checkSourceReference(root, { file: "lib/thing.ts", symbol: "doThing" })).toBe("found");
    rmSync(path.join(root, "lib/thing.ts"));
    expect(checkSourceReference(root, { file: "lib/thing.ts", symbol: "doThing" })).toBe("missing");
  });
});

describe("computeWorkflowSourceChecks", () => {
  it("warns on missing sources and keys checks by file and symbol", () => {
    write("lib/real.ts", "export function realThing() {}\n");
    const parsed = parseWorkflow(
      {
        schemaVersion: "0.1",
        id: "wf",
        name: "Workflow",
        purpose: "Does things.",
        steps: [
          {
            id: "step-1",
            name: "Step 1",
            purpose: "Does the thing.",
            sources: [{ file: "lib/real.ts", symbol: "realThing" }, { file: "lib/missing.ts" }],
          },
        ],
        connections: [],
      },
      ".codehq/workflows/wf.json",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("expected workflow to parse");

    const { sourceChecks, issues } = computeWorkflowSourceChecks(root, parsed.value, ".codehq/workflows/wf.json");
    expect(sourceChecks["lib/real.ts#realThing"]).toBe("found");
    expect(sourceChecks["lib/missing.ts"]).toBe("missing");
    expect(issues).toHaveLength(1);
    expect(issues[0]).toEqual(expect.objectContaining({ severity: "warning" }));
    expect(issues[0]?.message).toContain("step-1");
    expect(issues[0]?.message).toContain("lib/missing.ts");
  });
});
