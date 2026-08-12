import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const schemaAlias = fileURLToPath(new URL("./src/schema", import.meta.url));
const coreAlias = fileURLToPath(new URL("./src/core", import.meta.url));
const serverAlias = fileURLToPath(new URL("./src/server", import.meta.url));
const webAlias = fileURLToPath(new URL("./src/web", import.meta.url));

const DOM_WEB_TEST_GLOBS = ["tests/unit/web/**/*.test.tsx", "tests/unit/web/store.test.ts", "**/*.web.test.tsx"];
const PURE_WEB_TEST_GLOBS = [
  "tests/unit/web/fitViewport.test.ts",
  "tests/unit/web/graph.test.ts",
  "tests/unit/web/layout.test.ts",
  "tests/unit/web/search-index.test.ts",
  "tests/unit/web/semantics.test.ts",
  "tests/unit/web/tokens.test.ts",
  "**/*.web.test.ts",
];

export default defineConfig({
  resolve: {
    alias: {
      "@schema": schemaAlias,
      "@core": coreAlias,
      "@server": serverAlias,
      "@web": webAlias,
    },
  },
  // Lets the "web" project's .tsx test files use the automatic JSX runtime (matching
  // tsconfig.web.json's "jsx": "react-jsx") without needing React in scope. Harmless for the
  // "node" project, which has no .tsx files to transform.
  esbuild: {
    jsx: "automatic",
  },
  test: {
    // Local Fastify integration servers can exceed Vitest's 5s default during a cold Windows
    // start, even though their request/response behavior is otherwise deterministic.
    testTimeout: 10_000,
    exclude: ["tests/e2e/**", "node_modules/**", "dist/**"],
    // Split by capability: pure web logic stays in fast plain Node; only component/store
    // tests that actually use browser globals pay the jsdom setup cost.
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts", ...PURE_WEB_TEST_GLOBS],
          exclude: [...DOM_WEB_TEST_GLOBS, "tests/e2e/**", "node_modules/**", "dist/**"],
        },
      },
      {
        extends: true,
        test: {
          name: "web",
          environment: "jsdom",
          include: DOM_WEB_TEST_GLOBS,
          exclude: ["tests/e2e/**", "node_modules/**", "dist/**"],
          setupFiles: ["./tests/unit/web/setup.ts"],
        },
      },
    ],
  },
});
