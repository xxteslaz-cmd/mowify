import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// @/lib/auth/hash exports the same functions as @/lib/auth/password but
// without the server-only guard, so it only exists so standalone scripts
// (the org backfill, the seed script, tests) can hash outside a bundler that
// understands "server-only". Application code must go through password.ts
// instead, or the guard that's supposed to keep hashing out of the client
// bundle is just a convention nobody enforces.
const restrictHashImport = {
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["@/lib/auth/hash", "**/auth/hash", "./hash"],
            message:
              "Import hashSecret/verifySecret from '@/lib/auth/password' instead of '@/lib/auth/hash' — password.ts carries the server-only guard that keeps hashing out of client bundles.",
          },
        ],
      },
    ],
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    files: ["**/*.{ts,tsx}"],
    ...restrictHashImport,
  },
  // Standalone scripts, tests, and password.ts itself (the one file allowed
  // to re-export from hash.ts) are exempt — see the comment above.
  {
    files: ["prisma/**/*.ts", "src/test/**/*.ts", "src/lib/auth/password.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
]);

export default eslintConfig;
