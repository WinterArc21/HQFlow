/**
 * Runs against the shared, read-only server (see playwright.config.ts's `webServer`). No
 * axe-core dependency is added here — the accessible-name sweep below is a small, self
 * contained DOM heuristic (aria-label / aria-labelledby / associated <label> / text content /
 * title), deliberately kept in `tests/e2e/**` rather than pulling in a new devDependency.
 */
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.locator("[data-step-node]").first().waitFor({ state: "visible", timeout: 15_000 });
});

test("every interactive control has an accessible name", async ({ page }) => {
  const unnamed = await page.evaluate(() => {
    const SELECTOR =
      'button, a[href], input, select, textarea, [role="button"], [role="link"], [role="switch"], [role="checkbox"], [role="combobox"]';

    const isVisible = (el: Element): boolean => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };

    const accessibleName = (el: Element): string => {
      const ariaLabel = el.getAttribute("aria-label");
      if (ariaLabel !== null && ariaLabel.trim().length > 0) {
        return ariaLabel.trim();
      }

      const labelledBy = el.getAttribute("aria-labelledby");
      if (labelledBy !== null) {
        const text = labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ")
          .trim();
        if (text.length > 0) {
          return text;
        }
      }

      if (el instanceof HTMLInputElement) {
        if (el.labels && el.labels.length > 0) {
          const text = Array.from(el.labels)
            .map((label) => label.textContent ?? "")
            .join(" ")
            .trim();
          if (text.length > 0) {
            return text;
          }
        }
        if ((el.type === "submit" || el.type === "button") && el.value.trim().length > 0) {
          return el.value.trim();
        }
        if (el.placeholder.trim().length > 0) {
          return el.placeholder.trim();
        }
      }

      const title = el.getAttribute("title");
      if (title !== null && title.trim().length > 0) {
        return title.trim();
      }

      return (el.textContent ?? "").trim();
    };

    return Array.from(document.querySelectorAll(SELECTOR))
      .filter(isVisible)
      .filter((el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true")
      .filter((el) => accessibleName(el).length === 0)
      .map((el) => el.outerHTML.slice(0, 200));
  });

  expect(unnamed, `Interactive elements with no accessible name:\n${unnamed.join("\n---\n")}`).toEqual([]);
});

test("a focused control has a visible focus indicator", async ({ page }) => {
  await page.locator('[data-step-node="receive-request"]').focus();

  const focusStyle = await page.evaluate(() => {
    const el = document.activeElement;
    if (el === null) {
      return null;
    }
    const style = getComputedStyle(el);
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, boxShadow: style.boxShadow };
  });

  expect(focusStyle).not.toBeNull();
  const hasVisibleOutline = focusStyle !== null && focusStyle.outlineStyle !== "none" && focusStyle.outlineWidth !== "0px";
  const hasVisibleShadow = focusStyle !== null && focusStyle.boxShadow !== "none" && focusStyle.boxShadow.length > 0;
  expect(hasVisibleOutline || hasVisibleShadow).toBe(true);
});

test("no horizontal page scroll at 1024px or 1440px", async ({ page }) => {
  for (const width of [1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `Horizontal overflow of ${overflow}px at viewport width ${width}px`).toBeLessThanOrEqual(1);
  }
});
