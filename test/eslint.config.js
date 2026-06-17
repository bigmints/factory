const tseslint = require("typescript-eslint");

module.exports = [
  {
    ignores: ["eslint.config.js"]
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-unused-vars": "error"
    }
  }
];
