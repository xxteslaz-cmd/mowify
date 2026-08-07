import "dotenv/config";
import { execFileSync } from "child_process";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is not set in .env");
if (!url.includes("test")) {
  // The whole point of this script is to target the throwaway database.
  throw new Error("TEST_DATABASE_URL does not look like a test database");
}

// Only allow specific flags to be forwarded. A caller passing --url would override
// the checked test database URL, since Prisma honors the last occurrence of repeated
// flags. The guards above constrain TEST_DATABASE_URL, but forwarding arbitrary
// caller arguments would bypass them entirely and enable pushing to production.
const ALLOWED_FLAGS = ["--accept-data-loss"];
const extra = process.argv.slice(2);
const rejected = extra.filter((arg) => !ALLOWED_FLAGS.includes(arg));
if (rejected.length > 0) {
  throw new Error(
    `Refusing to forward unrecognized flag(s): ${rejected.join(" ")}. ` +
      `Only ${ALLOWED_FLAGS.join(", ")} are permitted.`,
  );
}

execFileSync("npx", ["prisma", "db", "push", "--url", url, ...extra], {
  stdio: "inherit",
});
