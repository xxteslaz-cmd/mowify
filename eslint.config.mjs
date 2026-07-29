import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// @/lib/auth/hash exports the same functions as @/lib/auth/password but
// without the server-only guard, so it only exists so standalone scripts
// (the org backfill, the seed script, tests) can hash outside a bundler that
// understands "server-only". Application code must go through password.ts
// instead, or the guard that's supposed to keep hashing out of the client
// bundle is just a convention nobody enforces. Server actions are exactly the
// application code most likely to reach for it directly, so this pattern must
// stay live there — it must not be lifted as a side effect of exempting some
// other pattern for the same files.
const hashPattern = {
  group: ["@/lib/auth/hash", "**/auth/hash", "./hash"],
  message:
    "Import hashSecret/verifySecret from '@/lib/auth/password' instead of '@/lib/auth/hash' — password.ts carries the server-only guard that keeps hashing out of client bundles.",
};

// @/lib/email/client carries the Resend API key. It has its own server-only
// guard, but the guard only throws if the module is actually evaluated in a
// browser bundle — restricting the import statement itself catches the
// mistake at lint time instead of at bundle time.
const emailPattern = {
  group: ["@/lib/email/client", "**/email/client"],
  message:
    "Import sendEmail/appUrl from '@/lib/email/client' only from server actions (src/app/**/actions.ts) or tests — it holds the Resend API key and must never reach a client bundle.",
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
  // Default: both restrictions apply everywhere. Each exemption below is
  // scoped to only the pattern it needs to lift, kept as its own selector,
  // so that "no-restricted-imports" is never turned off wholesale for files
  // that only need relief from one of the two patterns.
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [hashPattern, emailPattern] }],
    },
  },
  // Standalone scripts (the org backfill, the seed script) and password.ts
  // itself (the one file allowed to re-export from hash.ts) need the hash
  // exemption but have no business importing the email client, so the email
  // pattern stays active for them.
  {
    files: ["prisma/**/*.ts", "src/lib/auth/password.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [emailPattern] }],
    },
  },
  // Server actions are where sendEmail is meant to be called from, so they
  // need the email exemption — but they must keep the hash restriction,
  // since they're exactly the code most likely to reach for hash.ts by
  // mistake instead of password.ts.
  {
    files: ["src/app/**/actions.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [hashPattern] }],
    },
  },
  // Tests legitimately need both: factories hash secrets directly via
  // hash.ts, and email tests exercise the client directly.
  {
    files: ["src/test/**/*.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
]);

export default eslintConfig;
