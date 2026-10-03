import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  { ignores: ["**/dist/**", "dist-npm/**", "packages/cli/ui/**", "packages/cli/bundle/**", "**/.next/**", "**/out/**", "apps/web/src/components/block/**", "apps/web/src/lib/effects/**", "**/node_modules/**", "docs/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ["**/*.mjs"], languageOptions: { globals: globals.node } },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: { "react-hooks/rules-of-hooks": "error", "react-hooks/exhaustive-deps": "warn" },
  },
  {
    // GitHub webhook and API payloads are untyped third-party JSON, and tests inspect loosely typed responses.
    files: ["**/*.test.ts", "**/test-env.ts", "packages/server/src/github/**"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
);
