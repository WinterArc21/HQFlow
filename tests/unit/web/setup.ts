import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

if (typeof window !== "undefined") {
  const entries = new Map<string, string>();
  const localStorage: Storage = {
    get length() { return entries.size; },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => Array.from(entries.keys())[index] ?? null,
    removeItem: (key) => { entries.delete(key); },
    setItem: (key, value) => { entries.set(key, String(value)); },
  };
  Object.defineProperty(window, "localStorage", { configurable: true, value: localStorage });
}

// Without this, DOM trees from earlier tests in the same file accumulate (React Testing
// Library does not clean up automatically outside of Jest's global afterEach hook).
afterEach(() => {
  cleanup();
});

// --- React Flow polyfills (jsdom lacks these; the canvas explicitly sets node width/height
// itself, so it never depends on real measurements — these stubs only need to exist, not
// measure anything, for React Flow's internals to run without throwing). ---

if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe(): void {
      // No-op: layout.ts computes node size from workflow content, never from the DOM.
    }
    unobserve(): void {
      // No-op, see above.
    }
    disconnect(): void {
      // No-op, see above.
    }
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

if (typeof window !== "undefined" && window.matchMedia === undefined) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

if (typeof window !== "undefined" && window.DOMMatrixReadOnly === undefined) {
  class DOMMatrixReadOnlyStub {
    m22 = 1;
    constructor(_transform?: string) {
      // No-op: only React Flow's internal zoom-level parsing needs this to exist.
    }
  }
  window.DOMMatrixReadOnly = DOMMatrixReadOnlyStub as unknown as typeof DOMMatrixReadOnly;
}
