import globals from "globals";
import js from "@eslint/js";
import stylisticJs from "@stylistic/eslint-plugin-js";
import html from "@html-eslint/eslint-plugin";
import htmlParser from "@html-eslint/parser";
import eslintPluginYml from "eslint-plugin-yml";

/** @type {import("eslint").Linter.Config[]} */
export default [
  // Base JavaScript configuration
  js.configs.recommended,

  // Custom JavaScript configuration
  {
		files: ["**/*.js"],
    plugins: {
      js,
      "@stylistic/js": stylisticJs
    },
    languageOptions: {
      sourceType: "module",
      globals: {
        ...globals.browser,
        Typed: true,
        axios: true,
        Sentry: true,
      },
    },
		rules: {
      "no-unused-vars": "error",
      "@stylistic/js/indent": ["warn", 4],
      "@stylistic/js/semi": "error",
      "@stylistic/js/no-extra-semi": "warn",
      "@stylistic/js/comma-spacing": ["warn", {"before": false, "after": true}],
      "@stylistic/js/comma-dangle": ["warn", "always-multiline"],
      "@stylistic/js/quotes": ["warn", "double"],
      "@stylistic/js/spaced-comment": ["warn", "always"],
      "@stylistic/js/arrow-spacing": "warn",
      "@stylistic/js/block-spacing": ["warn", "never"],
      "@stylistic/js/key-spacing": "warn",
      "@stylistic/js/keyword-spacing": "warn",
      "@stylistic/js/space-before-blocks": "warn",
      "@stylistic/js/space-before-function-paren": ["warn", "never"],
      "@stylistic/js/space-in-parens": "warn",
		},
	},

  // HTML configuration
  {
    ...html.configs["flat/recommended"],
    files: ["**/*.html"],
    plugins: {
      "@html-eslint": html,
    },
    languageOptions: {
      parser: htmlParser,
    },
    rules: {
      ...html.configs["flat/recommended"].rules,
      "@html-eslint/indent": ["warn", "tab"],
      "@html-eslint/attrs-newline": "off",
      "@html-eslint/element-newline": "off",
      "@html-eslint/no-obsolete-tags": "warn",
      "@html-eslint/no-trailing-spaces": "warn",
    },
  },

  // YAML configuration
  ...eslintPluginYml.configs["flat/standard"],
  {
    rules: {
      "yml/no-empty-mapping-value": "warn",
    },
  },
];