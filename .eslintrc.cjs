module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react/recommended",
    "plugin:react-hooks/recommended",
    "prettier",
  ],
  ignorePatterns: ["dist", ".eslintrc.cjs"],
  parser: "@typescript-eslint/parser",
  plugins: ["import"],
  settings: { react: { version: "18.3" } },
  rules: {
    // Enforces the feature-module boundary from 4.1.1.1.2: a feature folder
    // importing directly from another feature folder fails lint, not just
    // code review. NOTE: this glob-based zone config couldn't be verified
    // against a real ESLint run in the environment this was written in (no
    // network access to install dependencies) — worth double-checking this
    // rule actually fires correctly once `npm install` has run, rather than
    // trusting it blindly.
    "import/no-restricted-paths": [
      "error",
      {
        zones: [
          {
            target: "./src/features/*",
            from: "./src/features/*",
            except: ["../*"],
            message: "Feature modules may not import directly from another feature module (4.1.1.1.2).",
          },
        ],
      },
    ],
  },
};
