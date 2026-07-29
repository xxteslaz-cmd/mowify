import "dotenv/config";
import { execFileSync } from "child_process";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is not set in .env");
if (!url.includes("test")) {
  // The whole point of this script is to target the throwaway database.
  throw new Error("TEST_DATABASE_URL does not look like a test database");
}

execFileSync("npx", ["prisma", "db", "push", "--url", url], {
  stdio: "inherit",
});
