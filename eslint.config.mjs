import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// @/lib/auth/hash exports the same functions as @/lib/auth/password but
// without the server-only guard, so it only exists so standalone scripts
// (the org backfill, the seed script, tests) can hash outside a bundler that
// understands "server-only". Application code must go through password.ts
// instead, or the guard that's supposed to keep hashing out of the client
// bundle is just a convention nobody enforces.
//
// @/lib/email/client carries the Resend API key. It has its own server-only
// guard, but the guard only throws if the module is actually evaluated in a
// browser bundle — restricting the import statement itself catches the
// mistake at lint time instead of at bundle time.
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
          {
            group: ["@/lib/email/client", "**/email/client"],
            message:
              "Import sendEmail/appUrl from '@/lib/email/client' only from server actions (src/app/**/actions.ts) or tests — it holds the Resend API key and must never reach a client bundle.",
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
  // to re-export from hash.ts) are exempt from the hash restriction — see the
  // comment above. Server actions and tests are exempt from the email
  // restriction, since those are exactly the places sendEmail is meant to be
  // called from.
  {
    files: [
      "prisma/**/*.ts",
      "src/test/**/*.ts",
      "src/lib/auth/password.ts",
      "src/app/**/actions.ts",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
]);

export default eslintConfig;
