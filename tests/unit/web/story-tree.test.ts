import { describe, expect, it } from "vitest";
import type { Behavior } from "@schema/behavior";
import { layoutStoryTree } from "@web/components/behavior/storyTree";

const moment = (id: string, kind?: "start" | "end") => ({ id, name: id, purpose: id, ...(kind !== undefined ? { kind } : {}) });

// The start moment is listed last, so a layout that roots at the first moment fails.
const behavior: Behavior = {
  schemaVersion: "0.1",
  id: "edit",
  name: "Editing",
  purpose: "A user edits a map.",
  moments: [moment("cards"), moment("banner"), moment("vanish", "end"), moment("orphan"), moment("open", "start")],
  transitions: [
    { from: "open", to: "cards", label: "the page loads" },
    { from: "cards", to: "banner", label: "a broken edit" },
    { from: "banner", to: "cards", label: "it repairs the file" },
    { from: "banner", to: "vanish", label: "you restart" },
  ],
};

describe("layoutStoryTree", () => {
  const tree = layoutStoryTree(behavior);
  const box = (id: string) => tree.nodes.find((node) => node.kind === "moment" && node.momentId === id)!;

  it("draws every moment once, and a loop as a pill under its source instead of a second box", () => {
    expect(tree.nodes.filter((node) => node.kind === "moment").map((node) => node.momentId).sort())
      .toEqual(["banner", "cards", "open", "orphan", "vanish"]);
    const jump = tree.nodes.find((node) => node.kind === "jump");
    expect(jump).toMatchObject({ momentId: "cards", back: true });
    expect(jump!.y).toBeGreaterThan(box("banner").y);
  });

  it("starts at the start moment and reads top to bottom, with branches in transition order", () => {
    expect(box("open").y).toBeLessThan(box("cards").y);
    expect(box("cards").y).toBeLessThan(box("banner").y);
    const jump = tree.nodes.find((node) => node.kind === "jump")!;
    expect(jump.x + jump.width).toBeLessThanOrEqual(box("vanish").x);
    expect(tree.starts).toHaveLength(1);
    expect(tree.starts[0]!.x).toBe(box("open").x + box("open").width / 2);
  });

  it("writes each event on the arrow into its target and marks the split with a diamond", () => {
    const into = (id: string) => tree.edges.find((edge) => edge.label !== undefined && edge.label.x === box(id).x + box(id).width / 2 && edge.label.y < box(id).y && edge.label.y > box(id).y - 100);
    expect(into("vanish")?.label?.text).toBe("you restart");
    expect(into("cards")?.label?.text).toBe("the page loads");
    expect(tree.diamonds).toHaveLength(1);
  });
});
