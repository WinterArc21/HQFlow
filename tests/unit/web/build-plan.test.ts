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
    expect(result.cursors).toHaveLength(1);
    expect(result.cursors[0]!.length).toBeGreaterThan(0);
  });

  it("splits a big build between several cursors that join their runs at the end", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
    const chain = {
      ...base,
      steps: ids.map((id) => ({ id, name: id.toUpperCase(), purpose: `Step ${id}.`, category: "logic" })),
      connections: ids.slice(1).map((id, index) => ({ from: ids[index]!, to: id })),
    } as Workflow;
    const result = plan(null, chain)!;
    const layout = computeLayout(chain, { expandedStepIds: {} });

    expect(result.cursors).toHaveLength(3);
    // Drawn at once, it lands in about the time one cursor takes for three cards, not nine.
    expect(result.total).toBeLessThan(6000);
    for (const edge of layout.edges) {
      const draw = result.edges.get(edge.id)!;
      const target = result.nodes.get(edge.target)!;
      const source = result.nodes.get(edge.source)!;
      // Either the cursor inks it on the way into its target, or both cards are already there.
      const ridesIn = draw.delay + draw.duration <= target.delay;
      const joinsLater = draw.delay >= source.delay + source.duration * 0.9 && draw.delay >= target.delay + target.duration * 0.9;
      expect(ridesIn || joinsLater, edge.id).toBe(true);
    }
    // Two of the eight links cross between runs; each cursor's key times never go backwards.
    expect([...result.edges.values()].filter((draw) => draw.delay >= Math.max(...[...result.nodes.values()].map((node) => node.delay)))).toHaveLength(2);
    for (const keys of result.cursors) {
      keys.slice(1).forEach((key, index) => expect(key.t).toBeGreaterThan(keys[index]!.t));
    }
  });
});
