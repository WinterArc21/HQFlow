import { describe, expect, it } from "vitest";
import { inboundPoint, outboundPoint, type PresenceNodeBox } from "@web/components/canvas/cardGeometry";

const BOX: PresenceNodeBox = { id: "card", x: 10, y: 20, width: 100, height: 60, radius: 10 };

describe("card geometry", () => {
  it("places construction travel on the card's left and right midpoint ports", () => {
    expect(inboundPoint(BOX)).toEqual({ x: 10, y: 50 });
    expect(outboundPoint(BOX)).toEqual({ x: 110, y: 50 });
  });
});
