// @ts-check
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", ".codehq/**", "coverage/**", "playwright-report/**", "test-results/**", "landing/**", "prototypes/**"],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-console": "error",
    },
  },
  {
    files: ["src/cli/**", "src/server/**"],
    rules: {
      "no-console": "off",
    },
  },
  {
    // CLI tests intercept console.log/console.error to assert on rendered terminal output.
    files: ["tests/unit/cli/**"],
    rules: {
      "no-console": "off",
    },
  },
  {
    // The e2e suite's config-load bootstrap and spawned-process helpers legitimately log
    // build/server diagnostics to the terminal.
    files: ["tests/e2e/**", "playwright.config.ts"],
    rules: {
      "no-console": "off",
    },
  },
  {
    files: ["src/web/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
);
