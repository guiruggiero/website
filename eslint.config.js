// Imports
import {defineConfig} from "eslint/config";
import js from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";
import globals from "globals";
import html from "@html-eslint/eslint-plugin";
import css from "@eslint/css";
import eslintPluginYml from "eslint-plugin-yml";
import markdown from "@eslint/markdown";

export default defineConfig([
  // JavaScript configuration
  {
    files: ["**/*.js"],
    ignores: ["eslint.config.js"],
    plugins: {
      js,
      "@stylistic": stylistic,
    },
    extends: ["js/recommended"],
    languageOptions: {
      globals: {
        ...globals.browser,
        Typed: true,
        axios: true,
        axiosRetry: true,
        Sentry: true,
      },
    },
    rules: {
      "no-unused-vars": "warn",
      "@stylistic/indent": ["warn", 4],
      "@stylistic/semi": "error",
      "@stylistic/no-extra-semi": "warn",
      "@stylistic/comma-spacing": ["warn", {"before": false, "after": true}],
      "@stylistic/comma-dangle": ["warn", "always-multiline"],
      "@stylistic/quotes": ["warn", "double"],
      "@stylistic/spaced-comment": ["warn", "always"],
      "@stylistic/arrow-spacing": "warn",
      "@stylistic/block-spacing": ["warn", "never"],
      "@stylistic/key-spacing": "warn",
      "@stylistic/keyword-spacing": "warn",
      "@stylistic/space-before-blocks": "warn",
      "@stylistic/space-before-function-paren": ["warn", "never"],
      "@stylistic/space-in-parens": "warn",
    },
  },

  // HTML configuration
  {
    files: ["**/*.html"],
    plugins: {html},
    language: "html/html",
    extends: ["html/recommended"],
    rules: {
      "html/attrs-newline": "off",
      "html/element-newline": "off",
      "html/no-obsolete-tags": "warn",
      "html/no-trailing-spaces": "warn",
    },
  },

  // CSS configuration
  {
    files: ["**/*.css"],
    plugins: {css},
    language: "css/css",
    extends: ["css/recommended"],
    rules: {"css/no-invalid-properties": ["error", {allowUnknownVariables: true}]},
  },

  // YAML configuration
  ...eslintPluginYml.configs["flat/standard"],
  {
    files: ["**/*.yml"],
    rules: {"yml/no-empty-mapping-value": "warn"},
  },

  // Markdown configuration
  {
    files: ["**/*.md"],
    plugins: {markdown},
    language: "markdown/gfm",
    extends: ["markdown/recommended"],
  },
]);