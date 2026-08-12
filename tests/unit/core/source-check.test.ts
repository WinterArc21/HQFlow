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

  it("marks references without a verifiable code declaration as file-only", () => {
    write("lib/thing.ts", "export function thing() {}\n");
    expect(checkSourceReference(root, { file: "lib/thing.ts" })).toBe("file-only");
    write("README.md", "## thing\n");
    expect(checkSourceReference(root, { file: "README.md", symbol: "thing" })).toBe("file-only");

    const misses = [
      ["line-comment.ts", "// function realSymbol() {}\nexport const other = 1;\n", "realSymbol"],
      ["block-comment.ts", "/* function realSymbol() {} */\nexport const other = 1;\n", "realSymbol"],
      ["substring.ts", "export function realSymbolExtended() { return 1; }\n", "realSymbol"],
      ["unknown.ts", "export const somethingElse = 1;\n", "missingSymbol"],
    ] as const;
    for (const [file, contents, symbol] of misses) {
      write(`lib/${file}`, contents);
      expect(checkSourceReference(root, { file: `lib/${file}`, symbol }), file).toBe("file-only");
    }
  });

  it("recognizes supported declaration forms without comment false positives", () => {
    const declarations = [
      ["function.ts", "export function doThing() { return 1; }\n", "doThing"],
      ["route.ts", "export async function POST(request: Request) { return new Response(); }\n", "POST"],
      ["class.ts", "export class Thing {}\n", "Thing"],
      ["arrow.ts", "export const doThing = (x: number) => x + 1;\n", "doThing"],
      ["method.ts", "export class Thing {\n  doThing(x: number) { return x; }\n}\n", "doThing"],
      ["re-export.ts", "function doThing() { return 1; }\nexport { doThing };\n", "doThing"],
      ["url.ts", 'const base = "https://example.com"; export function doThing() { return base; }\n', "doThing"],
    ] as const;
    for (const [file, contents, symbol] of declarations) {
      write(`lib/${file}`, contents);
      expect(checkSourceReference(root, { file: `lib/${file}`, symbol }), file).toBe("verified");
    }
  });

  it("re-reads a file after its mtime changes", () => {
    write("lib/thing.ts", "export const somethingElse = 1;\n");
    expect(checkSourceReference(root, { file: "lib/thing.ts", symbol: "doThing" })).toBe("file-only");
    write("lib/thing.ts", "export function doThing() { return 1; }\n");
    expect(checkSourceReference(root, { file: "lib/thing.ts", symbol: "doThing" })).toBe("verified");
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
    expect(sourceChecks["lib/real.ts#realThing"]).toBe("verified");
    expect(sourceChecks["lib/missing.ts"]).toBe("missing");
    expect(issues).toHaveLength(1);
    expect(issues[0]).toEqual(expect.objectContaining({ severity: "warning" }));
    expect(issues[0]?.message).toContain("step-1");
    expect(issues[0]?.message).toContain("lib/missing.ts");
  });
});
