import path from "node:path";

import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const javascriptFiles = ["**/*.{js,cjs,mjs,jsx}"];
const typescriptFiles = ["**/*.{ts,cts,mts,tsx}"];
const webFiles = ["apps/web/**/*.{js,jsx,ts,tsx}"];

export function createMensalyConfig({ rootDirectory }) {
  const nextConfig = nextPlugin.flatConfig.coreWebVitals;
  const reactHooksConfig = reactHooks.configs.flat.recommended;

  return defineConfig([
    globalIgnores(
      [
        "**/node_modules/**",
        "**/.next/**",
        "**/.turbo/**",
        "**/coverage/**",
        "**/dist/**",
        "**/node_modules/.prisma/**",
        "apps/web/next-env.d.ts",
      ],
      "mensaly/generated-files",
    ),
    {
      name: "mensaly/javascript",
      files: javascriptFiles,
      extends: [js.configs.recommended],
      languageOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    {
      name: "mensaly/typescript",
      files: typescriptFiles,
      extends: [js.configs.recommended, ...tseslint.configs.recommended],
    },
    {
      name: "mensaly/node",
      files: [
        "apps/api/**/*.ts",
        "apps/worker/**/*.ts",
        "packages/**/*.{js,cjs,mjs,ts,cts,mts}",
        "*.{js,cjs,mjs}",
      ],
      languageOptions: {
        globals: globals.node,
      },
    },
    {
      name: "mensaly/commonjs",
      files: ["**/*.cjs"],
      languageOptions: {
        globals: globals.node,
        sourceType: "commonjs",
      },
    },
    {
      name: "mensaly/browser",
      files: webFiles,
      languageOptions: {
        globals: {
          ...globals.browser,
          ...globals.es2022,
        },
      },
    },
    {
      name: "mensaly/react-hooks",
      files: webFiles,
      plugins: reactHooksConfig.plugins,
      rules: reactHooksConfig.rules,
    },
    {
      name: "mensaly/next",
      files: webFiles,
      plugins: nextConfig.plugins,
      rules: nextConfig.rules,
      settings: {
        next: {
          rootDir: path.join(rootDirectory, "apps/web"),
        },
      },
    },
    {
      name: "mensaly/next-plugin-detection",
      files: ["eslint.config.mjs"],
      plugins: nextConfig.plugins,
    },
    {
      name: "mensaly/tests",
      files: [
        "**/*.test.{js,jsx,ts,tsx}",
        "**/*.spec.{js,jsx,ts,tsx}",
      ],
      languageOptions: {
        globals: globals.node,
      },
    },
    {
      name: "mensaly/linter-options",
      linterOptions: {
        reportUnusedDisableDirectives: "error",
      },
    },
  ]);
}
