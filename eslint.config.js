import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

const nodeGlobals = {
  console: "readonly",
  process: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  Buffer: "readonly",
  __dirname: "readonly",
  __filename: "readonly",
  module: "readonly",
  require: "readonly",
  exports: "writable",
};

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    ignores: [
      "**/dist/",
      "**/node_modules/",
      "**/.output/",
      "**/.wxt/",
      ".vercel/",
      "docs/devdash/",
      "apps/mobile/ios/",
    ],
  },
  {
    // Node scripts & config files (not browser-bundled).
    files: ["**/*.mjs", "**/*.cjs", "**/*.config.js", "apps/web/promo/**", "apps/mobile/polyfills.js"],
    languageOptions: { globals: nodeGlobals },
  },
  {
    // CommonJS config files legitimately use require().
    files: ["**/*.config.js", "apps/mobile/polyfills.js"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
);
