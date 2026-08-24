import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveTemplatesDir } from "../../../src/cli/templates";

describe("resolveTemplatesDir", () => {
  it("finds templates/codehq when running from source (e.g. under tsx or vitest)", () => {
    const dir = resolveTemplatesDir();
    expect(existsSync(dir)).toBe(true);
    expect(existsSync(path.join(dir, "project.json"))).toBe(true);
    expect(existsSync(path.join(dir, "SKILL.md"))).toBe(true);
  });

  it("throws a clear, actionable error when no templates directory can be found nearby", () => {
    const fakeDeepPath = path.join(tmpdir(), "codehq-templates-missing", "a", "b", "c", "d", "file.ts");
    const bogusUrl = pathToFileURL(fakeDeepPath).href;
    expect(() => resolveTemplatesDir(bogusUrl)).toThrow(/templates\/codehq/);
  });
});
