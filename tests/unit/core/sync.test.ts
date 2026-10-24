import { describe, expect, it } from "vitest";
import { contentHash, decideSync } from "@core/sync";

describe("decideSync", () => {
  it.each([
    // [local, remote, base, expected, case]
    ["a", "a", null, "none", "same content on both sides, never synced"],
    ["b", "a", "a", "push", "edited locally"],
    ["a", "b", "a", "pull", "edited on another device"],
    ["b", "c", "a", "conflict", "edited on both sides"],
    ["a", null, null, "push", "new local workflow"],
    [null, "a", null, "pull", "new workflow from another device"],
    [null, "a", "a", "push", "deleted locally, so delete in the cloud"],
    ["a", null, "a", "pull", "deleted on another device, so delete locally"],
    [null, "b", "a", "conflict", "deleted locally but edited elsewhere"],
    ["b", null, "a", "conflict", "edited locally but deleted elsewhere"],
    ["a", "b", null, "conflict", "both sides exist and differ at the first sync"],
  ] as const)("%s/%s/%s -> %s (%s)", (local, remote, base, expected, _case) => {
    expect(decideSync(local, remote, base)).toBe(expected);
  });
});

describe("contentHash", () => {
  it("ignores object key order, because Postgres jsonb reorders keys", () => {
    expect(contentHash({ id: "x", steps: [{ b: 1, a: 2 }] })).toBe(contentHash({ steps: [{ a: 2, b: 1 }], id: "x" }));
  });

  it("detects a change in array order", () => {
    expect(contentHash({ steps: ["a", "b"] })).not.toBe(contentHash({ steps: ["b", "a"] }));
  });
});
