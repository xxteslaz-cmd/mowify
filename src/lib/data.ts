import { prisma } from "./prisma";
import { parseISODate } from "./date";

export async function getActiveCrews() {
  return prisma.crew.findMany({
    where: { active: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function getAllCrews() {
  // Job counts drive whether a crew can be deleted in Manage Crews.
  return prisma.crew.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { jobs: true } } },
  });
}

export async function getJobsForDate(dateISO: string) {
  const date = parseISODate(dateISO);
  return prisma.job.findMany({
    where: { scheduledDate: date },
    include: { customer: true, crew: true },
    orderBy: [{ orderInDay: "asc" }],
  });
}

export async function searchCustomers(query: string) {
  if (!query.trim()) {
    return prisma.customer.findMany({ orderBy: { name: "asc" }, take: 100 });
  }
  return prisma.customer.findMany({
    where: {
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { address: { contains: query, mode: "insensitive" } },
        { phone: { contains: query, mode: "insensitive" } },
      ],
    },
    orderBy: { name: "asc" },
    take: 100,
  });
}

export async function getCustomerWithJobs(customerId: string) {
  return prisma.customer.findUnique({
    where: { id: customerId },
    include: {
      jobs: {
        include: { crew: true },
        orderBy: { scheduledDate: "desc" },
      },
    },
  });
}

export async function getCrewTodayJobs(crewId: string, dateISO: string) {
  const date = parseISODate(dateISO);
  const [crew, jobs] = await Promise.all([
    prisma.crew.findUnique({ where: { id: crewId } }),
    prisma.job.findMany({
      where: { crewId, scheduledDate: date, status: { not: "SKIPPED" } },
      include: { customer: true },
      orderBy: { orderInDay: "asc" },
    }),
  ]);
  return { crew, jobs };
}
