import "dotenv/config";
import { configDefaults, defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    setupFiles: ["src/test/setup.ts"],
    // Tests truncate every table, so they must never see the development
    // database. This override is the only thing standing between a test run
    // and real data.
    env: { DATABASE_URL: process.env.TEST_DATABASE_URL ?? "" },
    // These tests share one Postgres database, so they must not run in
    // parallel against each other.
    fileParallelism: false,
    // A git worktree created under .claude/worktrees/ is a second full copy of
    // src/, so without this every suite gets collected twice and the two copies
    // truncate the same test database out from under each other. The failures
    // that produces are spectacularly misleading — they surface as assertion
    // errors in unrelated tests, not as anything pointing at the duplication.
    // Spread the defaults rather than replacing them; this option overrides
    // node_modules and dist rather than adding to them.
    exclude: [...configDefaults.exclude, "**/.claude/**"],
    alias: { "server-only": "/src/test/empty.ts" },
  },
});
