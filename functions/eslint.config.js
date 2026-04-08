import {fileURLToPath} from "node:url";
import path from "node:path";
import {FlatCompat} from "@eslint/eslintrc";
import {defineConfig} from "eslint/config";
import js from "@eslint/js";
import globals from "globals";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({baseDirectory: __dirname});

export default defineConfig([
  js.configs.recommended,
  ...compat.extends("google"),
  {
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "module",
      globals: {
        ...globals.es2020,
        ...globals.node,
      },
    },
    rules: {
      "valid-jsdoc": "off",
      "require-jsdoc": "off",
      "no-restricted-globals": ["error", "name", "length"],
      "prefer-arrow-callback": "error",
      "quotes": ["error", "double", {allowTemplateLiterals: true}],
      "no-unused-vars": "warn",
      "no-useless-assignment": "warn",
      "indent": ["error", 2],
    },
  },
  {
    files: ["**/*.spec.*"],
    languageOptions: {
      globals: {
        ...globals.mocha,
      },
    },
  },
]);
