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
  await prisma.session.deleteMany();
  await prisma.job.deleteMany();
  await prisma.user.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.crew.deleteMany();
  await prisma.pendingSignup.deleteMany();
  await prisma.org.deleteMany();
}

beforeEach(async () => {
  await resetDb();
});
