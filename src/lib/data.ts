import { prisma } from "./prisma";
import { parseISODate, toISODate } from "./date";
import { requireOwner, verifySession } from "./auth/dal";

export type DaySummary = { count: number; colors: string[] };

/**
 * Per-day job counts and crew colours for the calendar, so a day shows whether
 * work is scheduled without having to be clicked.
 */
export async function getDaySummaries(
  days: Date[],
): Promise<Record<string, DaySummary>> {
  // The auth check must run before the early return below, otherwise an
  // unauthenticated caller passing an empty array would get a silent {}
  // instead of being redirected to sign in.
  const { orgId } = await requireOwner();
  if (days.length === 0) return {};

  const jobs = await prisma.job.findMany({
    where: {
      orgId,
      scheduledDate: { gte: days[0], lte: days[days.length - 1] },
      status: { not: "SKIPPED" },
    },
    select: { scheduledDate: true, crew: { select: { color: true } } },
  });

  const summaries: Record<string, DaySummary> = {};
  for (const job of jobs) {
    const key = toISODate(job.scheduledDate);
    const entry = (summaries[key] ??= { count: 0, colors: [] });
    entry.count++;
    if (job.crew && !entry.colors.includes(job.crew.color)) {
      entry.colors.push(job.crew.color);
    }
  }
  return summaries;
}

export async function getActiveCrews() {
  const { orgId } = await requireOwner();
  return prisma.crew.findMany({
    where: { active: true, orgId },
    orderBy: { createdAt: "asc" },
  });
}

export async function getAllCrews() {
  const { orgId } = await requireOwner();
  // Job counts drive whether a crew can be deleted in Manage Crews.
  return prisma.crew.findMany({
    where: { orgId },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { jobs: true } } },
  });
}

export async function getJobsForDate(dateISO: string) {
  const { orgId } = await requireOwner();
  const date = parseISODate(dateISO);
  return prisma.job.findMany({
    where: { orgId, scheduledDate: date },
    include: { customer: true, crew: true },
    orderBy: [{ orderInDay: "asc" }],
  });
}

export async function searchCustomers(query: string) {
  const { orgId } = await requireOwner();
  if (!query.trim()) {
    return prisma.customer.findMany({
      where: { orgId },
      orderBy: { name: "asc" },
      take: 100,
    });
  }
  return prisma.customer.findMany({
    where: {
      orgId,
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

export async function getCustomers() {
  const { orgId } = await requireOwner();
  return prisma.customer.findMany({ where: { orgId }, orderBy: { name: "asc" } });
}

export async function getCustomersWithJobCounts() {
  const { orgId } = await requireOwner();
  return prisma.customer.findMany({
    where: { orgId },
    orderBy: { name: "asc" },
    include: { _count: { select: { jobs: true } } },
  });
}

export async function getCustomerWithJobs(customerId: string) {
  const { orgId } = await requireOwner();
  // findUnique can't take a compound id-plus-orgId filter, since orgId isn't
  // part of the customer's unique key. findFirst returning null for another
  // company's customer is deliberate: the page already renders that as a 404,
  // which makes a foreign record indistinguishable from one that doesn't exist.
  return prisma.customer.findFirst({
    where: { id: customerId, orgId },
    include: {
      // Defence in depth: the customer row above is already org-scoped, so a
      // customer can't structurally have another org's job attached under
      // correct data — but nothing at this line depends on that holding, in
      // case a write path elsewhere ever lets one slip through.
      jobs: {
        where: { orgId },
        include: { crew: true },
        orderBy: { scheduledDate: "desc" },
      },
    },
  });
}

export async function getCrewTodayJobs(crewId: string, dateISO: string) {
  // Both crew members and owners reach this function, so it only requires a
  // valid session rather than the OWNER role.
  const user = await verifySession();

  // A crew member may only open their own day. Returning an empty result
  // rather than throwing lets the page render its existing 404.
  if (user.role === "CREW" && user.crewId !== crewId) {
    return { crew: null, jobs: [] };
  }

  const date = parseISODate(dateISO);
  const [crew, jobs] = await Promise.all([
    prisma.crew.findFirst({ where: { id: crewId, orgId: user.orgId } }),
    prisma.job.findMany({
      where: {
        orgId: user.orgId,
        crewId,
        scheduledDate: date,
        status: { not: "SKIPPED" },
      },
      include: { customer: true },
      orderBy: { orderInDay: "asc" },
    }),
  ]);
  return { crew, jobs };
}
