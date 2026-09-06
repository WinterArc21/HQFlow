import { describe, expect, it } from "vitest";
import { parseRepositoryMap } from "@schema/validate";

const FILE = ".codehq/repository-map.json";

function validMap() {
  return {
    schemaVersion: "0.1",
    workflows: [
      { id: "checkout", name: "Checkout", purpose: "Turns a cart into an order." },
      { id: "fulfilment", name: "Fulfilment", purpose: "Ships paid orders." },
    ],
    connections: [
      {
        from: "checkout",
        to: "fulfilment",
        label: "paid order",
        sources: [{ file: "src/orders.ts", symbol: "createOrder" }],
      },
    ],
  };
}

describe("parseRepositoryMap", () => {
  it("accepts workflows and evidence-backed handoffs", () => {
    const result = parseRepositoryMap(validMap(), FILE);
    expect(result.ok).toBe(true);
  });

  it("rejects a handoff without source evidence", () => {
    const map = validMap();
    const result = parseRepositoryMap({ ...map, connections: [{ from: "checkout", to: "fulfilment", sources: [] }] }, FILE);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.issues.some((issue) => issue.path === "connections[0].sources")).toBe(true);
  });

  it("rejects connections to undeclared workflows", () => {
    const map = validMap();
    const result = parseRepositoryMap({
      ...map,
      connections: [{ from: "checkout", to: "refunds", sources: [{ file: "src/orders.ts" }] }],
    }, FILE);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.issues.some((issue) => issue.path === "connections[0].to")).toBe(true);
  });
});
