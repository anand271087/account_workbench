// Flat config for ESLint v9 — migrated from .eslintrc.cjs.
// Same rules, same intent. v9 dropped the legacy .eslintrc format.
//
// `pnpm lint` runs this with `--max-warnings 0`, so warnings fail CI.

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";

export default [
  {
    ignores: [
      "dist",
      "node_modules",
      // Tailwind config uses require() for plugins by design (canonical pattern).
      "tailwind.config.ts",
      "postcss.config.js",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.es2022 },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // We deliberately export hooks (useAuth, useAccountFromLayout) alongside
      // their components — Fast Refresh edge case isn't worth the friction.
      "react-refresh/only-export-components": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          // `const {a, b, ...rest} = obj` is the idiomatic "drop these keys" pattern.
          ignoreRestSiblings: true,
        },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
];
