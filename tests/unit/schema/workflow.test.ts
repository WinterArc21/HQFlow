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

// The example workflow lives once, under templates/codehq/workflows, and is loaded
// directly here rather than duplicated into a test fixture so the two cannot drift.
const FIXTURE_PATH = fileURLToPath(
  new URL("../../../templates/codehq/workflows/example-generate-video.json", import.meta.url),
);
const FILE = ".codehq/workflows/generate-video.json";

function loadFixture(): RawWorkflow {
  const raw = readFileSync(FIXTURE_PATH, "utf-8");
  return JSON.parse(raw) as RawWorkflow;
}

describe("parseWorkflow — generate-video example", () => {
  it("parses the full example with no errors and no warnings", () => {
    const result = parseWorkflow(loadFixture(), FILE);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`expected ok, got issues: ${JSON.stringify(result.issues)}`);
    }
    expect(result.value.id).toBe("generate-video");
    // A loose range, not an exact count: this guards "the example is still a substantial,
    // parseable workflow" without pinning the example's editorial shape. The upper bound covers
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

  it("rejects an absolute POSIX path in SourceReference.file", () => {
    const data = loadFixture();
    data.steps[0]!.sources![0]!.file = "/etc/passwd";

    const result = parseWorkflow(data, FILE);

    expect(result.ok).toBe(false);
  });

  it("rejects a windows drive-letter path in SourceReference.file", () => {
    const data = loadFixture();
    data.steps[0]!.sources![0]!.file = "C:\\secrets\\file.ts";

    const result = parseWorkflow(data, FILE);

    expect(result.ok).toBe(false);
  });

  it("rejects a path containing a '..' segment in SourceReference.file", () => {
    const data = loadFixture();
    data.steps[0]!.sources![0]!.file = "../../etc/passwd";

    const result = parseWorkflow(data, FILE);

    expect(result.ok).toBe(false);
  });

  it("rejects a visual 'x'/'y' coordinate property on a step", () => {
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
  });

  it("rejects a visual 'color' property on a step", () => {
    const data = loadFixture();
    data.steps[0]!.color = "#fff";

    const result = parseWorkflow(data, FILE);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected failure");
    }
    expect(result.issues).toContainEqual(expect.objectContaining({
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

describe("parseWorkflow — corrected field shapes (status, entryPoint, notes)", () => {
  it("rejects status: 'active' because it is not in the closed enum, naming the allowed values", () => {
    const data = loadFixture();
    data.status = "active";

    const result = parseWorkflow(data, FILE);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected failure");
    }
    const issue = result.issues.find((i) => i.path === "status");
    expect(issue).toBeDefined();
    expect(issue?.message).toContain("draft");
    expect(issue?.message).toContain("verified");
    expect(issue?.message).toContain("needs-review");
  });

  it("rejects a string entryPoint (the old, incorrect shape)", () => {
    const data = loadFixture();
    data.entryPoint = "POST /api/x" as unknown as NonNullable<RawWorkflow["entryPoint"]>;

    const result = parseWorkflow(data, FILE);

    expect(result.ok).toBe(false);
  });

  it("rejects entryPoint.file that is not repository-relative, with the repository-relative message", () => {
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
  });

  it("rejects entryPoint.line greater than entryPoint.endLine", () => {
    const data = loadFixture();
    data.entryPoint = { file: "a.ts", line: 9, endLine: 2 };

    const result = parseWorkflow(data, FILE);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected failure");
    }
    const issue = result.issues.find((i) => i.path === "entryPoint.line");
    expect(issue).toBeDefined();
  });

  it("rejects a string notes field (the old, incorrect shape)", () => {
    const data = loadFixture();
    data.notes = "hello";

    const result = parseWorkflow(data, FILE);

    expect(result.ok).toBe(false);
  });

  it("accepts notes as an array of strings", () => {
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
