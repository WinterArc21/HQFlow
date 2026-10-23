import { describe, expect, it } from "vitest";
import type { Workflow } from "@schema/workflow";
import { computeLayout } from "@web/components/canvas/layout";
import { planBuild } from "@web/components/canvas/live/buildPlan";

const base: Workflow = {
  schemaVersion: "0.1",
  id: "checkout",
  name: "Checkout",
  purpose: "Takes an order through payment.",
  steps: [
    { id: "start", name: "Start", purpose: "Receives the cart.", category: "entry" },
    { id: "price", name: "Price", purpose: "Prices the cart.", category: "logic" },
  ],
  connections: [{ from: "start", to: "price" }],
} as Workflow;

function plan(previous: Workflow | null, next: Workflow) {
  const layout = computeLayout(next, { expandedStepIds: {} });
  return planBuild(previous, next, layout, () => undefined, 1);
}

describe("planBuild", () => {
  it("plans nothing when the workflow is unchanged", () => {
    expect(plan(base, structuredClone(base))).toBeNull();
  });

  it("inks each new card's incoming edge before tracing the card, in the order the chain grows", () => {
    const next = structuredClone(base);
    next.steps.push(
      { id: "pay", name: "Pay", purpose: "Charges the card.", category: "external" },
      { id: "ship", name: "Ship", purpose: "Books delivery.", category: "output" },
    );
    next.connections.push({ from: "price", to: "pay" }, { from: "pay", to: "ship" });
    const result = plan(base, next)!;

    expect([...result.nodes.keys()]).toEqual(["pay", "ship"]);
    expect(result.nodes.has("price")).toBe(false);
    const layout = computeLayout(next, { expandedStepIds: {} });
    const edgeInto = (target: string) => result.edges.get(layout.edges.find((edge) => edge.target === target)!.id)!;
    for (const id of ["pay", "ship"]) {
      const edge = edgeInto(id);
      expect(edge.delay + edge.duration, id).toBeLessThanOrEqual(result.nodes.get(id)!.delay);
    }
    expect(result.nodes.get("ship")!.delay).toBeGreaterThan(result.nodes.get("pay")!.delay);
    expect(result.edges.size).toBe(2);
    expect(result.added).toBe(2);
  });

  it("marks an edited step as changed without redrawing it", () => {
    const next = structuredClone(base);
    next.steps[1]!.purpose = "Prices the cart and applies discounts.";
    const result = plan(base, next)!;
    expect([...result.changed]).toEqual(["price"]);
    expect(result.nodes.size).toBe(0);
  });

  it("replays the whole map from an empty canvas", () => {
    const result = plan(null, base)!;
    expect([...result.nodes.keys()]).toEqual(["start", "price"]);
    expect(result.cursor.length).toBeGreaterThan(0);
  });
});
