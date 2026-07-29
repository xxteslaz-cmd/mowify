import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashSecret } from "../src/lib/auth/hash";
import { slugify } from "../src/lib/auth/slug";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

/**
 * Moves the pre-auth data into a single Org and creates its owner.
 *
 * Idempotent: if an Org already exists the script makes no changes, so a
 * repeated run during deployment is harmless.
 */
async function main() {
  const companyName = process.env.BACKFILL_COMPANY_NAME;
  const ownerName = process.env.BACKFILL_OWNER_NAME;
  const ownerEmail = process.env.BACKFILL_OWNER_EMAIL;
  const ownerPassword = process.env.BACKFILL_OWNER_PASSWORD;

  if (!companyName || !ownerName || !ownerEmail || !ownerPassword) {
    throw new Error(
      "Set BACKFILL_COMPANY_NAME, BACKFILL_OWNER_NAME, BACKFILL_OWNER_EMAIL " +
        "and BACKFILL_OWNER_PASSWORD before running this script.",
    );
  }

  const existing = await prisma.org.findFirst();
  if (existing) {
    console.log(`Org "${existing.name}" already exists; nothing to do.`);
    return;
  }

  const org = await prisma.org.create({
    data: { name: companyName, slug: slugify(companyName) },
  });

  await prisma.user.create({
    data: {
      orgId: org.id,
      role: "OWNER",
      name: ownerName,
      email: ownerEmail.toLowerCase(),
      passwordHash: await hashSecret(ownerPassword),
    },
  });

  // The one-time move of pre-auth Crew/Customer/Job rows into this Org is
  // done: orgId is now a required column, so there is nothing left with a
  // null orgId for updateMany to catch, and Prisma would refuse to typecheck
  // a `where: { orgId: null }` against a non-nullable column anyway. This
  // script now only bootstraps the Org and its owner for a fresh environment.
  console.log(`Created "${org.name}" (/c/${org.slug}) and its owner.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
