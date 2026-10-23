/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { SCENES } from "@web/design/scenes";

/**
 * Enforces contract §10/§12: "no hex value may appear in any component file, ever" — every
 * colour lives in `styles/tokens.css`, everything else references it via `var(--...)`.
 * Resolved from `process.cwd()` (vitest always runs from the repo root) rather than
 * `import.meta.url`, which is not guaranteed to be a `file:` URL under every test environment.
 */
const WEB_ROOT = join(process.cwd(), "src", "web");
const ALLOWED_FILE = join(WEB_ROOT, "styles", "tokens.css");

const HEX_COLOR_PATTERN = /#[0-9a-fA-F]{3,8}\b/;
const FUNCTIONAL_COLOR_PATTERN = /\b(rgb|rgba|hsl|hsla)\(/i;
const SCANNED_EXTENSIONS = new Set([".ts", ".tsx", ".css", ".html"]);

function collectFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      collectFiles(fullPath, out);
    } else {
      out.push(fullPath);
    }
  }
  return out;
}

describe("design token guard", () => {
  it("never uses a hex/rgb/hsl colour literal outside styles/tokens.css", () => {
    const files = collectFiles(WEB_ROOT).filter((file) => SCANNED_EXTENSIONS.has(file.slice(file.lastIndexOf("."))));

    const offenders = files
      .filter((file) => file !== ALLOWED_FILE)
      .filter((file) => {
        const content = readFileSync(file, "utf8");
        return HEX_COLOR_PATTERN.test(content) || FUNCTIONAL_COLOR_PATTERN.test(content);
      })
      .map((file) => relative(WEB_ROOT, file));

    expect(offenders).toEqual([]);
  });

  it("defines a token block, with all five shader colours, for every registered scene", () => {
    const tokens = readFileSync(ALLOWED_FILE, "utf8");
    for (const scene of SCENES) {
      const start = tokens.indexOf(`:root[data-scene="${scene.id}"]`);
      expect(start, scene.id).toBeGreaterThan(-1);
      const block = tokens.slice(start, tokens.indexOf("}", start));
      for (let i = 0; i < 5; i += 1) {
        expect(block, `${scene.id} --scene-c${i}`).toContain(`--scene-c${i}:`);
      }
    }
  });
});
