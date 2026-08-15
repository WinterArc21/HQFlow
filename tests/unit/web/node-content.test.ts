import { describe, expect, it } from "vitest";
import {
  NODE_WIDTH,
  PURPOSE_SINGLE_LINE_MAX_CHARS,
  PURPOSE_TWO_LINE_MAX_CHARS,
  computeNodeHeight,
  purposeLineCount,
} from "@web/components/canvas/nodeContent";
import type { WorkflowStep } from "@schema/workflow";

function makeStep(purpose: string, overrides: Partial<WorkflowStep> = {}): WorkflowStep {
  return { id: "step", name: "Step", purpose, ...overrides };
}

describe("option A card size", () => {
  it("fixes work cards at 320px wide", () => {
    expect(NODE_WIDTH).toBe(320);
  });

  it("sizes a three-line story card to 148px", () => {
    const purpose = "Converts the scraped page into a structured product model: name, tagline, summary, hero image, and keywords.";
    expect(purpose.length).toBeGreaterThan(PURPOSE_TWO_LINE_MAX_CHARS);
    expect(purposeLineCount(purpose)).toBe(3);
    expect(computeNodeHeight(makeStep(purpose), "workflow")).toBe(148);
  });

  it("reserves one, two, or three purpose lines from length", () => {
    expect(purposeLineCount("x".repeat(PURPOSE_SINGLE_LINE_MAX_CHARS))).toBe(1);
    expect(purposeLineCount("x".repeat(PURPOSE_SINGLE_LINE_MAX_CHARS + 1))).toBe(2);
    expect(purposeLineCount("x".repeat(PURPOSE_TWO_LINE_MAX_CHARS))).toBe(2);
    expect(purposeLineCount("x".repeat(PURPOSE_TWO_LINE_MAX_CHARS + 1))).toBe(3);
  });
});
