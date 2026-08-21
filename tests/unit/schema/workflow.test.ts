import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseWorkflow } from "@schema/validate";

interface RawSource {
  [key: string]: unknown;
  file: string;
  line?: number;
  endLine?: number;
}

interface RawEdgeCase {
  [key: string]: unknown;
  sources?: RawSource[];
}

interface RawStep {
  [key: string]: unknown;
  id: string;
  name: string;
  purpose: string;
  sources?: RawSource[];
  edgeCases?: RawEdgeCase[];
}

interface RawConnection {
  [key: string]: unknown;
  from: string;
  to: string;
}

interface RawWorkflow {
  [key: string]: unknown;
  entryPoint?: { [key: string]: unknown; file: string; line?: number; endLine?: number };
  steps: RawStep[];
  connections: RawConnection[];
}

// Use the end-to-end workflow fixture for broad schema coverage.
const FIXTURE_PATH = fileURLToPath(
  new URL("../../e2e/fixtures/project/.codehq/workflows/generate-video.json", import.meta.url),
);
const FILE = ".codehq/workflows/generate-video.json";

function loadFixture(): RawWorkflow {
  const raw = readFileSync(FIXTURE_PATH, "utf-8");
  return JSON.parse(raw) as RawWorkflow;
}

describe("parseWorkflow — generate-video fixture", () => {
  it("parses the full fixture with no errors and no warnings", () => {
    const result = parseWorkflow(loadFixture(), FILE);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`expected ok, got issues: ${JSON.stringify(result.issues)}`);
    }
    expect(result.value.id).toBe("generate-video");
    // A loose range, not an exact count: this guards a substantial, parseable workflow without
    // pinning the fixture's editorial shape. The upper bound covers
    // the 7 work steps plus the 4 terminal outcome steps the current canvas design expects.
    expect(result.value.steps.length).toBeGreaterThanOrEqual(5);
    expect(result.value.steps.length).toBeLessThanOrEqual(14);
    expect(result.warnings).toEqual([]);
  });
});

describe("parseWorkflow — shape and semantic rules", () => {
  it("rejects an empty steps array", () => {
    const data = loadFixture();
    data.steps = [];

    const result = parseWorkflow(data, FILE);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected failure");
    }
    expect(result.issues.some((issue) => /at least one step/i.test(issue.message))).toBe(true);
  });

  it("detects duplicate step ids and names the offending id", () => {
    const data = loadFixture();
    const first = data.steps[0]!;
    data.steps = [...data.steps, { ...first }];

    const result = parseWorkflow(data, FILE);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected failure");
    }
    const issue = result.issues.find((i) => i.message.includes("Duplicate step id"));
    expect(issue).toBeDefined();
    expect(issue?.message).toContain(`'${first.id}'`);
    expect(issue?.severity).toBe("error");
  });

  it("detects a connection referencing a missing step, with the correct path", () => {
    const data = loadFixture();
    data.connections = [...data.connections, { id: "bad", from: "receive-request", to: "no-such-step", type: "success" }];
    const lastIndex = data.connections.length - 1;

    const result = parseWorkflow(data, FILE);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected failure");
    }
    const issue = result.issues.find((i) => i.message.includes("no-such-step"));
    expect(issue).toBeDefined();
    expect(issue?.path).toBe(`connections[${lastIndex}].to`);
    expect(issue?.message).toBe("Connection references missing step 'no-such-step'.");
  });

  it("rejects absolute, drive-letter, and parent-traversal source paths", () => {
    for (const unsafePath of ["/etc/passwd", "C:\\secrets\\file.ts", "../../etc/passwd"]) {
      const data = loadFixture();
      data.steps[0]!.sources![0]!.file = unsafePath;
      expect(parseWorkflow(data, FILE).ok, unsafePath).toBe(false);
    }
  });

  it("rejects workflow-owned visual properties with precise diagnostics", () => {
    const data = loadFixture();
    data.steps[0]!.x = 10;
    data.steps[0]!.y = 20;

    const result = parseWorkflow(data, FILE);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected failure");
    }
    expect(
      result.issues.some(
        (issue) => issue.message === "Visual properties are owned by HQFlow and must not appear in workflow files.",
      ),
    ).toBe(true);
    const colorData = loadFixture();
    colorData.steps[0]!.color = "#fff";
    const colorResult = parseWorkflow(colorData, FILE);
    expect(colorResult.ok).toBe(false);
    if (colorResult.ok) {
      throw new Error("expected failure");
    }
    expect(colorResult.issues).toContainEqual(expect.objectContaining({
      path: "steps[0].color",
      message: "Visual properties are owned by HQFlow and must not appear in workflow files.",
    }));
  });

  it("rejects line > endLine on a SourceReference", () => {
    const data = loadFixture();
    data.steps[0]!.sources![0]!.line = 100;
    data.steps[0]!.sources![0]!.endLine = 10;

    const result = parseWorkflow(data, FILE);

    expect(result.ok).toBe(false);
  });

  it("warns, but does not error, on a step unreachable from any entry step", () => {
    const data = loadFixture();
    data.steps = [
      ...data.steps,
      { id: "orphan-step", name: "Orphan step", purpose: "Never connected to anything.", category: "logic" },
    ];

    const result = parseWorkflow(data, FILE);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`expected ok, got issues: ${JSON.stringify(result.issues)}`);
    }
    const warning = result.warnings.find((w) => w.message.includes("orphan-step"));
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe("warning");
    expect(warning?.message).toBe("Step 'orphan-step' is unreachable from any entry step.");
  });

  it("rejects a workflow id that does not match the required pattern", () => {
    const data = loadFixture();
    data.id = "Generate_Video!";

    const result = parseWorkflow(data, FILE);

    expect(result.ok).toBe(false);
  });
});

describe("parseWorkflow — corrected field shapes (entryPoint, notes)", () => {
  it("rejects an unrecognized status field because the schema no longer includes it", () => {
    const data = loadFixture();
    data.status = "active";

    const result = parseWorkflow(data, FILE);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected failure");
    }
    const issue = result.issues.find((i) => i.path === "status");
    expect(issue).toBeDefined();
    expect(issue?.message).toContain("Unrecognized property 'status'");
  });

  it("rejects legacy and unsafe entry-point shapes with useful paths", () => {
    const legacy = loadFixture();
    legacy.entryPoint = "POST /api/x" as unknown as NonNullable<RawWorkflow["entryPoint"]>;
    expect(parseWorkflow(legacy, FILE).ok).toBe(false);

    const data = loadFixture();
    data.entryPoint = { file: "../outside.ts" };

    const result = parseWorkflow(data, FILE);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected failure");
    }
    const issue = result.issues.find((i) => i.path === "entryPoint.file");
    expect(issue).toBeDefined();
    expect(issue?.message).toContain("'..' segment");

    const reversed = loadFixture();
    reversed.entryPoint = { file: "a.ts", line: 9, endLine: 2 };
    const reversedResult = parseWorkflow(reversed, FILE);
    expect(reversedResult.ok).toBe(false);
    if (reversedResult.ok) {
      throw new Error("expected failure");
    }
    expect(reversedResult.issues.find((i) => i.path === "entryPoint.line")).toBeDefined();
  });

  it("rejects legacy string notes and accepts the array shape", () => {
    const legacy = loadFixture();
    legacy.notes = "hello";
    expect(parseWorkflow(legacy, FILE).ok).toBe(false);

    const data = loadFixture();
    data.notes = ["hello"];

    const result = parseWorkflow(data, FILE);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`expected ok, got issues: ${JSON.stringify(result.issues)}`);
    }
    expect(result.value.notes).toEqual(["hello"]);
  });

  it("round-trips a valid entryPoint object through parseWorkflow", () => {
    const data = loadFixture();
    data.entryPoint = { file: "app/api/generate/route.ts", symbol: "POST", line: 12, endLine: 34 };

    const result = parseWorkflow(data, FILE);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`expected ok, got issues: ${JSON.stringify(result.issues)}`);
    }
    expect(result.value.entryPoint).toEqual({ file: "app/api/generate/route.ts", symbol: "POST", line: 12, endLine: 34 });
  });
});
