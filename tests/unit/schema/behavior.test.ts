import { describe, expect, it } from "vitest";
import { behaviorAsWorkflow } from "@schema/behavior";
import { parseBehavior } from "@schema/validate";

const FILE = ".codehq/behaviors/pay.json";

function validBehavior() {
  return {
    schemaVersion: "0.1",
    id: "pay",
    name: "Paying for an order",
    purpose: "A customer pays for their cart.",
    moments: [
      { id: "tap", name: "Taps Pay", purpose: "Starts paying.", kind: "start" },
      { id: "spin", name: "Sees a spinner", purpose: "Waits for the charge." },
      { id: "twice", name: "Charged twice", purpose: "Two charges for one order.", verdict: { status: "bug", evidence: "Reproduced." } },
      { id: "receipt", name: "Sees receipt", purpose: "Payment done.", kind: "end" },
    ],
    transitions: [
      { from: "tap", to: "spin", label: "taps Pay" },
      { from: "spin", to: "twice", label: "taps Pay again" },
      { id: "ok", from: "spin", to: "receipt", label: "payment goes through" },
    ],
  };
}

describe("parseBehavior", () => {
  it("accepts a journey with verdicts", () => {
    const result = parseBehavior(validBehavior(), FILE);
    expect(result).toMatchObject({ ok: true, warnings: [] });
  });

  it("rejects a transition to a missing moment and a verdict without evidence", () => {
    const missing = validBehavior();
    missing.transitions.push({ from: "spin", to: "nowhere", label: "waits" });
    const result = parseBehavior(missing, FILE);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.issues.map((issue) => issue.path)).toEqual(["transitions[3].to"]);

    const noEvidence = validBehavior();
    const moments = noEvidence.moments.map((moment) => moment.id === "twice" ? { ...moment, verdict: { status: "bug", evidence: " " } } : moment);
    expect(parseBehavior({ ...noEvidence, moments }, FILE).ok).toBe(false);
  });

  it("warns about a moment the user can never reach", () => {
    const behavior = validBehavior();
    behavior.transitions = behavior.transitions.filter((transition) => transition.to !== "twice");
    const result = parseBehavior(behavior, FILE);
    if (!result.ok) throw new Error("expected success");
    expect(result.warnings.map((issue) => issue.path)).toEqual(["moments[2].id"]);
  });

  it("rejects visual properties like workflow files do", () => {
    const behavior = { ...validBehavior(), moments: [{ ...validBehavior().moments[0], color: "red" }] };
    const result = parseBehavior(behavior, FILE);
    if (result.ok) throw new Error("expected failure");
    expect(result.issues[0]?.message).toBe("Visual properties are owned by HQFlow and must not appear in workflow files.");
  });
});

describe("behaviorAsWorkflow", () => {
  it("draws start moments as entries, never draws outcome pills, and keeps transition ids stable", () => {
    const result = parseBehavior(validBehavior(), FILE);
    if (!result.ok) throw new Error("expected success");
    const workflow = behaviorAsWorkflow(result.value);
    expect(workflow.steps.map((step) => step.category)).toEqual(["entry", "logic", "logic", "logic"]);
    expect(workflow.connections.map((connection) => connection.id)).toEqual(["transition-0", "transition-1", "ok"]);
  });
});
