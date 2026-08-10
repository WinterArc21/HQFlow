import { describe, expect, it } from "vitest";
import type { Issue } from "@schema/diagnostics";
import { bold, dim, pluralize, printIssues, red, yellow } from "../../../src/cli/output";

const ESC = String.fromCharCode(27);

function withEnv(vars: Record<string, string | undefined>, run: () => void): void {
  const originalTTY = process.stdout.isTTY;
  const originalNoColor = process.env.NO_COLOR;
  try {
    if (vars.NO_COLOR === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = vars.NO_COLOR;
    }
    if (vars.isTTY !== undefined) {
      process.stdout.isTTY = vars.isTTY === "true";
    }
    run();
  } finally {
    process.stdout.isTTY = originalTTY;
    if (originalNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = originalNoColor;
    }
  }
}

describe("color helpers", () => {
  it("emit no ANSI escapes when NO_COLOR is set, even on a TTY", () => {
    withEnv({ NO_COLOR: "1", isTTY: "true" }, () => {
      expect(bold("x")).toBe("x");
      expect(dim("x")).toBe("x");
      expect(red("x")).toBe("x");
      expect(yellow("x")).toBe("x");
    });
  });

  it("emit no ANSI escapes when stdout is not a TTY", () => {
    withEnv({ NO_COLOR: undefined, isTTY: "false" }, () => {
      expect(bold("x")).toBe("x");
      expect(red("x")).toBe("x");
    });
  });

  it("emit ANSI escapes when a TTY and NO_COLOR is unset", () => {
    withEnv({ NO_COLOR: undefined, isTTY: "true" }, () => {
      expect(bold("x")).toContain(ESC);
      expect(red("x")).toContain(ESC);
    });
  });
});

describe("pluralize", () => {
  it("uses the singular form for exactly 1", () => {
    expect(pluralize(1, "error")).toBe("1 error");
    expect(pluralize(1, "workflow")).toBe("1 workflow");
  });

  it("uses the plural form for 0 and for more than 1", () => {
    expect(pluralize(0, "error")).toBe("0 errors");
    expect(pluralize(3, "error")).toBe("3 errors");
  });
});

describe("printIssues", () => {
  function capture(run: () => void): string[] {
    const lines: string[] = [];
    const original = console.log;
    console.log = (msg?: unknown) => {
      lines.push(String(msg));
    };
    try {
      run();
    } finally {
      console.log = original;
    }
    return lines;
  }

  it("groups issues by file and aligns the dimmed hint under the path column", () => {
    withEnv({ NO_COLOR: "1", isTTY: "false" }, () => {
      const issues: Issue[] = [
        {
          severity: "error",
          file: ".codehq/workflows/checkout.json",
          path: "connections[3].to",
          message: "Connection references missing step 'create-order'.",
          hint: "Add a step with id 'create-order', or point this connection at an existing step.",
        },
      ];

      const lines = capture(() => {
        printIssues(issues, "/repo");
      });

      expect(lines[0]).toBe(".codehq/workflows/checkout.json");
      expect(lines[1]).toBe("  error  connections[3].to  Connection references missing step 'create-order'.");
      expect(lines[2]).toBe("         Add a step with id 'create-order', or point this connection at an existing step.");
    });
  });

  it("sorts files alphabetically and errors before warnings within a file", () => {
    withEnv({ NO_COLOR: "1", isTTY: "false" }, () => {
      const issues: Issue[] = [
        { severity: "warning", file: "b.json", message: "A warning." },
        { severity: "error", file: "a.json", message: "An error." },
        { severity: "warning", file: "a.json", message: "Another warning." },
      ];

      const lines = capture(() => {
        printIssues(issues, "/repo");
      });

      expect(lines[0]).toBe("a.json");
      expect(lines[1]).toContain("error");
      expect(lines[2]).toContain("warning");
    });
  });
});
