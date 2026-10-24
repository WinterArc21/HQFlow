import { describe, expect, it } from "vitest";
import { outcomeTone } from "@web/design/semantics";

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
