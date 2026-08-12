import { describe, expect, it } from "vitest";
import {
  categoryToken,
  confidenceStyle,
  connectionStyle,
  outcomeEdgeStyle,
  outcomeTone,
  RETRY_EDGE_VISUAL,
  sourceStatusTone,
  statusTone,
} from "@web/design/semantics";
import type { SourceStatus } from "@web/api/types";
import type { Workflow, WorkflowStep } from "@schema/workflow";

describe("categoryToken", () => {
  const cases: Array<[WorkflowStep["category"], string]> = [
    ["entry", "--accent-output"],
    ["logic", "--accent-neutral"],
    ["decision", "--accent-rose"],
    ["data", "--accent-orange"],
    ["external", "--accent-orchid"],
    ["output", "--accent-output"],
  ];

  it("maps every category to the intended distinct design token", () => {
    for (const [category, varName] of cases) {
      expect(categoryToken(category).varName, category).toBe(varName);
    }
    const shared = categoryToken("entry").varName;
    const middle = (["logic", "decision", "data", "external"] as const).map((c) => categoryToken(c).varName);
    expect(categoryToken("output").varName).toBe(shared);
    expect(middle).not.toContain(shared);
    expect(new Set(middle).size).toBe(middle.length);
  });

  it("falls back to a neutral marker when category is unspecified", () => {
    const result = categoryToken(undefined);
    expect(result.varName).toBe("--accent-neutral");
    expect(result.label).toBeTruthy();
  });
});

describe("confidenceStyle", () => {
  it("maps every confidence state, including the default", () => {
    expect(confidenceStyle("verified").marker).toBe("solid");
    expect(confidenceStyle("inferred").marker).toBe("dashed");
    expect(confidenceStyle("human-confirmed").marker).toBe("solid-dot");
    expect(confidenceStyle(undefined).marker).toBe("solid");
  });
});

describe("connectionStyle", () => {
  it("maps every connection type to its complete visual grammar", () => {
    const result = connectionStyle("failure");
    expect(result.varName).toBe("--accent-red");
    expect(result.dash).toBe("dashed");
    expect(result.showLabel).toBe(true);
    expect(connectionStyle("conditional")).toEqual(expect.objectContaining({ varName: "--accent-amber", dash: "dashed", showLabel: true }));
    expect(connectionStyle("async")).toEqual(expect.objectContaining({ varName: "--accent-blue", dash: "dotted", showLabel: true }));
    const success = connectionStyle("success");
    expect(success.varName).toBe("--accent-neutral");
    expect(success.dash).toBe("none");
    expect(success.showLabel).toBe(false);
    expect(connectionStyle(undefined)).toEqual(success);
  });

  it("does not rely on colour alone to distinguish branch types", () => {
    expect(connectionStyle("failure").dash).not.toBe("none");
    expect(connectionStyle("conditional").dash).not.toBe("none");
    expect(connectionStyle("async").dash).not.toBe("none");
    // Failure and conditional would be indistinguishable to someone who can't perceive their
    // colour difference if they shared a dash pattern too — they don't.
    expect(connectionStyle("failure").dash).toBe(connectionStyle("conditional").dash);
    expect(connectionStyle("failure").varName).not.toBe(connectionStyle("conditional").varName);
  });
});

describe("RETRY_EDGE_VISUAL", () => {
  it("is amber and dashed, distinct from a plain failure edge's colour", () => {
    expect(RETRY_EDGE_VISUAL.varName).toBe("--accent-amber");
    expect(RETRY_EDGE_VISUAL.dash).toBe("dashed");
    expect(RETRY_EDGE_VISUAL.varName).not.toBe(connectionStyle("failure").varName);
  });
});

describe("outcomeEdgeStyle", () => {
  it("distinguishes terminal success while preserving terminal failure", () => {
    const outcome = outcomeEdgeStyle("success");
    const ordinary = connectionStyle("success");

    expect(outcome.varName).toBe("--accent-output");
    expect(outcome.dash).toBe("dashed");
    expect(outcome.weight).toBe("branch");
    expect(outcome.varName).not.toBe(ordinary.varName);
    expect(outcome.dash).not.toBe(ordinary.dash);
    expect(outcomeEdgeStyle("failure")).toEqual(connectionStyle("failure"));
  });
});

describe("outcomeTone", () => {
  it("classifies uniform, mixed, and empty incoming connections", () => {
    expect(outcomeTone(["failure"])).toBe("failure");
    expect(outcomeTone(["failure", "failure"])).toBe("failure");
    expect(outcomeTone(["success"])).toBe("success");
    expect(outcomeTone([undefined])).toBe("success");
    expect(outcomeTone(["success", undefined])).toBe("success");
    expect(outcomeTone(["success", "failure"])).toBe("neutral");
    expect(outcomeTone(["conditional", "failure"])).toBe("neutral");
    expect(outcomeTone(["async", "success"])).toBe("neutral");
    expect(outcomeTone([])).toBe("neutral");
  });
});

describe("statusTone", () => {
  const cases: Array<[Workflow["status"], string]> = [
    ["draft", "neutral"],
    ["verified", "green"],
    ["needs-review", "amber"],
  ];

  it("maps every workflow status and the default", () => {
    for (const [status, tone] of cases) {
      expect(statusTone(status).tone, status).toBe(tone);
    }
    expect(statusTone(undefined).tone).toBe("neutral");
  });
});

describe("sourceStatusTone", () => {
  const cases: Array<[SourceStatus, string]> = [
    ["verified", "green"],
    ["file-only", "amber"],
    ["missing", "red"],
  ];

  it("maps every source status", () => {
    for (const [status, tone] of cases) {
      expect(sourceStatusTone(status).tone, status).toBe(tone);
    }
  });
});
