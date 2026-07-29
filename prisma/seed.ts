import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { addDays, todayDate } from "../src/lib/date";

async function main() {
  // Every crew, customer and job now belongs to an Org, so seeding needs one
  // to attach to. This script deliberately never creates one: backfill-org.ts
  // decides it has nothing to do as soon as ANY Org exists, so a seed script
  // that made its own Org on an empty database would leave a company with
  // seeded data and no login, permanently convincing the backfill its job is
  // done. Requiring an Org to already exist removes that ordering hazard
  // instead of papering over it.
  const org = await prisma.org.findFirst();
  if (!org) {
    throw new Error(
      "No company exists yet. Run `npm run db:backfill-org`, or sign up in the app, before seeding.",
    );
  }

  // This database has held one real company's data (and its real owner
  // login) since the auth backfill ran. Seeding deletes every crew, customer
  // and job unconditionally, and there is no backup — so refuse unless the
  // operator explicitly overrides, rather than silently wiping a live business.
  const userCount = await prisma.user.count({ where: { orgId: org.id } });
  if (userCount > 0 && process.env.SEED_FORCE !== "1") {
    throw new Error(
      `"${org.name}" has ${userCount} real login(s). Seeding deletes every crew, ` +
        `customer and job. Re-run with SEED_FORCE=1 if you are certain.`,
    );
  }

  await prisma.job.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.crew.deleteMany();

  const [crewA, crewB, crewC] = await Promise.all([
    prisma.crew.create({ data: { orgId: org.id, name: "Crew 1", color: "#2563eb" } }),
    prisma.crew.create({ data: { orgId: org.id, name: "Crew 2", color: "#16a34a" } }),
    prisma.crew.create({ data: { orgId: org.id, name: "Mike's Crew", color: "#ea580c" } }),
  ]);

  const customers = await Promise.all(
    [
      { name: "Alvarez Residence", address: "142 Maple St, Springfield", phone: "555-010-1122", notes: "Gate code 4471. Dog in backyard." },
      { name: "Bennett Family", address: "89 Oak Ave, Springfield", phone: "555-010-3344", notes: "Call before arriving." },
      { name: "Springfield HOA - Willow Court", address: "1 Willow Ct, Springfield", phone: "555-010-5566", notes: "" },
      { name: "Diaz Property", address: "27 Birch Rd, Shelbyville", phone: "555-010-7788", notes: "Park on street, driveway is narrow." },
      { name: "Nguyen Residence", address: "560 Cedar Ln, Shelbyville", phone: "555-010-9900", notes: "" },
    ].map((c) => prisma.customer.create({ data: { ...c, orgId: org.id } })),
  );

  const today = todayDate();

  const jobsData = [
    { customer: customers[0], crew: crewA, service: "MOW" as const, freq: "WEEKLY" as const, offset: 0, order: 0 },
    { customer: customers[1], crew: crewA, service: "MOW" as const, freq: "WEEKLY" as const, offset: 0, order: 1 },
    { customer: customers[2], crew: crewB, service: "MULCH" as const, freq: "ONE_TIME" as const, offset: 0, order: 0 },
    { customer: customers[3], crew: crewC, service: "MOW" as const, freq: "BIWEEKLY" as const, offset: 1, order: 0 },
    { customer: customers[4], crew: crewB, service: "CLEANUP" as const, freq: "ONE_TIME" as const, offset: 2, order: 0 },
  ];

  for (const j of jobsData) {
    await prisma.job.create({
      data: {
        orgId: org.id,
        customerId: j.customer.id,
        crewId: j.crew.id,
        serviceType: j.service,
        frequency: j.freq,
        scheduledDate: addDays(today, j.offset),
        orderInDay: j.order,
        seriesId: j.freq === "WEEKLY" || j.freq === "BIWEEKLY" ? crypto.randomUUID() : null,
      },
    });
  }

  console.log(`Seeded 3 crews, 5 customers, 5 jobs into "${org.name}".`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
