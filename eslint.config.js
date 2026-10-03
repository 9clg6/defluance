import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/.next/**", "**/node_modules/**", "docs/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
