import { beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";

if (!process.env.DATABASE_URL?.includes("test")) {
  throw new Error(
    'Refusing to run tests: DATABASE_URL must contain "test". ' +
      "Point it at a scratch database, not development or production.",
  );
}

export async function resetDb() {
  // Order matters: children before parents, since foreign keys are enforced.
  // Task 2 adds the Session, User and Org deletes when those models exist —
  // referencing them before then would not typecheck.
  await prisma.job.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.crew.deleteMany();
}

beforeEach(async () => {
  await resetDb();
});
