import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

/**
 * Marks companies that existed before billing as permanently active.
 *
 * They signed up when the product was free, and dropping them to read-only on
 * deploy day would take away something they already had. They have no Stripe
 * customer, so nothing here will ever change their status again.
 *
 * Idempotent: only rows with no subscriptionStatus and no stripeCustomerId are
 * touched, so a repeated run changes nothing and a company that later
 * subscribes for real is never overwritten.
 */
async function main() {
  if (process.env.GRANDFATHER_CONFIRM !== "yes") {
    throw new Error(
      "Refusing to run: set GRANDFATHER_CONFIRM=yes. This writes to whatever " +
        "database DATABASE_URL points at, which is production by default.",
    );
  }

  const targets = await prisma.org.findMany({
    where: { subscriptionStatus: null, stripeCustomerId: null },
    select: { id: true, name: true },
  });

  if (targets.length === 0) {
    console.log("Nothing to grandfather.");
    return;
  }

  console.log(`Grandfathering ${targets.length} company(ies):`);
  for (const org of targets) console.log(`  - ${org.name}`);

  const { count } = await prisma.org.updateMany({
    where: { subscriptionStatus: null, stripeCustomerId: null },
    data: { subscriptionStatus: "active" },
  });

  console.log(`Updated ${count}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
