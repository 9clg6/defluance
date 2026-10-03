import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/.next/**", "**/node_modules/**", "docs/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // GitHub webhook and API payloads are untyped third-party JSON, and tests inspect loosely typed responses.
    files: ["**/*.test.ts", "**/test-env.ts", "packages/server/src/github/**"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
);
