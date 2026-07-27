import "dotenv/config";
import { prisma } from "../src/lib/prisma";

function addDays(base: Date, days: number) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

async function main() {
  await prisma.job.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.crew.deleteMany();

  const [crewA, crewB, crewC] = await Promise.all([
    prisma.crew.create({ data: { name: "Crew 1", color: "#2563eb" } }),
    prisma.crew.create({ data: { name: "Crew 2", color: "#16a34a" } }),
    prisma.crew.create({ data: { name: "Mike's Crew", color: "#ea580c" } }),
  ]);

  const customers = await Promise.all(
    [
      { name: "Alvarez Residence", address: "142 Maple St, Springfield", phone: "555-010-1122", notes: "Gate code 4471. Dog in backyard." },
      { name: "Bennett Family", address: "89 Oak Ave, Springfield", phone: "555-010-3344", notes: "Call before arriving." },
      { name: "Springfield HOA - Willow Court", address: "1 Willow Ct, Springfield", phone: "555-010-5566", notes: "" },
      { name: "Diaz Property", address: "27 Birch Rd, Shelbyville", phone: "555-010-7788", notes: "Park on street, driveway is narrow." },
      { name: "Nguyen Residence", address: "560 Cedar Ln, Shelbyville", phone: "555-010-9900", notes: "" },
    ].map((c) => prisma.customer.create({ data: c })),
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);

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

  console.log("Seeded 3 crews, 5 customers, 5 jobs.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
