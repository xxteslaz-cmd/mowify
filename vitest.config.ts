import "dotenv/config";
import { defineConfig } from "vitest/config";
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
    alias: { "server-only": "/src/test/empty.ts" },
  },
});
