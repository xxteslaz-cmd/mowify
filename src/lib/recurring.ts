import { randomUUID } from "crypto";
import { prisma } from "./prisma";
import { addDays, calculateNextOccurrenceDate, toISODate, todayDate } from "./date";
import type { Job, Prisma } from "@prisma/client";
import type { JobWithRelations, JobWithNextDate } from "./types";

const AUTO_GENERATED_FREQUENCIES: Job["frequency"][] = ["WEEKLY", "BIWEEKLY", "MONTHLY"];

/** How far ahead recurring visits are materialised as real Job rows. */
export const HORIZON_WEEKS = 12;

/** Stops a corrupt frequency/date combination from looping forever. */
const MAX_GENERATED_PER_SERIES = 400;

/** Whether a frequency produces follow-up visits (i.e. anything but ONE_TIME). */
export function isRecurring(frequency: Job["frequency"]): boolean {
  return AUTO_GENERATED_FREQUENCIES.includes(frequency);
}

export function horizonDate(from: Date = todayDate()): Date {
  return addDays(from, HORIZON_WEEKS * 7);
}

/**
 * When a recurring occurrence is resolved (completed or skipped), create the
 * next occurrence in its series so the owner never has to re-enter it.
 * Idempotent: won't duplicate if the next date already has a job for this series.
 */
export async function generateNextOccurrence(job: Job) {
  if (!AUTO_GENERATED_FREQUENCIES.includes(job.frequency) || !job.seriesId) return null;

  const nextDate = calculateNextOccurrenceDate(job.scheduledDate, job.frequency)!;

  // Scoped by orgId so a series id colliding across two companies (it can't in
  // practice, but nothing enforces that at the database level) never matches a
  // row that belongs to someone else.
  const existing = await prisma.job.findFirst({
    where: { orgId: job.orgId, seriesId: job.seriesId, scheduledDate: nextDate },
  });
  if (existing) return existing;

  return prisma.job.create({
    data: {
      orgId: job.orgId,
      customerId: job.customerId,
      crewId: job.crewId,
      serviceType: job.serviceType,
      customService: job.customService,
      frequency: job.frequency,
      scheduledDate: nextDate,
      orderInDay: job.orderInDay,
      seriesId: job.seriesId,
      status: "SCHEDULED",
    },
  });
}

/**
 * Materialises recurring visits as real Job rows out to `through`.
 *
 * Occurrences used to be created only when the previous one was completed, so
 * every future date on the board looked empty even though the card advertised a
 * "Next" date. Real rows mean editing, deleting and per-visit changes all work
 * on a future visit exactly as they do on today's.
 *
 * Idempotent: it skips dates a series already occupies, so repeated dashboard
 * renders (including the 10s auto-refresh poll) write nothing once caught up.
 */
export async function ensureOccurrencesThrough(
  orgId: string,
  through: Date,
): Promise<number> {
  // A recurring job with no seriesId can never generate a successor. MONTHLY
  // jobs were created that way before monthly recurrence was supported.
  const orphans = await prisma.job.findMany({
    where: { orgId, frequency: { in: AUTO_GENERATED_FREQUENCIES }, seriesId: null },
    select: { id: true },
  });
  for (const orphan of orphans) {
    await prisma.job.update({
      where: { id: orphan.id },
      data: { seriesId: randomUUID() },
    });
  }

  // Repair any column whose positions have drifted before handing out new ones,
  // so generated visits append after a clean 0..n-1 sequence.
  const nextPosition = await normalizeColumns(orgId);

  const rows = await prisma.job.findMany({
    where: {
      orgId,
      frequency: { in: AUTO_GENERATED_FREQUENCIES },
      seriesId: { not: null },
    },
    orderBy: { scheduledDate: "asc" },
  });

  const bySeries = new Map<string, Job[]>();
  for (const row of rows) {
    const list = bySeries.get(row.seriesId!) ?? [];
    list.push(row);
    bySeries.set(row.seriesId!, list);
  }

  const toCreate: Prisma.JobCreateManyInput[] = [];

  for (const [seriesId, list] of bySeries) {
    const taken = new Set(list.map((j) => toISODate(j.scheduledDate)));
    // The latest visit carries the current customer, crew and service, so it is
    // the right template for the ones that follow.
    const template = list[list.length - 1];

    let cursor = template.scheduledDate;
    for (let i = 0; i < MAX_GENERATED_PER_SERIES; i++) {
      const next = calculateNextOccurrenceDate(cursor, template.frequency);
      if (!next || next.getTime() > through.getTime()) break;

      const nextISO = toISODate(next);
      if (!taken.has(nextISO)) {
        taken.add(nextISO);

        // Position within the day it lands on, not the template's position —
        // inheriting that made every series in a series collide on one number.
        const key = `${nextISO}|${template.crewId}`;
        const position = nextPosition.get(key) ?? 0;
        nextPosition.set(key, position + 1);

        toCreate.push({
          orgId,
          customerId: template.customerId,
          crewId: template.crewId,
          serviceType: template.serviceType,
          customService: template.customService,
          frequency: template.frequency,
          scheduledDate: next,
          orderInDay: position,
          seriesId,
          status: "SCHEDULED",
        });
      }
      cursor = next;
    }
  }

  if (toCreate.length === 0) return 0;
  await prisma.job.createMany({ data: toCreate });
  return toCreate.length;
}

/**
 * Rewrites any crew-day whose orderInDay values aren't a clean 0..n-1 run.
 *
 * Generated visits used to inherit their template's position, so every series
 * landing on the same day claimed the same number and the crew's stop order was
 * decided by an arbitrary tie-break.
 *
 * Covers every column from today onwards rather than stopping at the generation
 * horizon, because paging the calendar further out leaves rows beyond it that
 * would otherwise never be repaired. Past days are left alone — their stop order
 * is history and rewriting it serves no one.
 *
 * Returns the next free position per `dateISO|crewId`, so the caller can append
 * to columns without colliding. Writes nothing when every column is already
 * sequential, which is the steady state.
 */
async function normalizeColumns(orgId: string): Promise<Map<string, number>> {
  const rows = await prisma.job.findMany({
    where: { orgId, scheduledDate: { gte: todayDate() } },
    orderBy: [{ orderInDay: "asc" }, { createdAt: "asc" }],
    select: { id: true, scheduledDate: true, crewId: true, orderInDay: true },
  });

  const columns = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = `${toISODate(row.scheduledDate)}|${row.crewId}`;
    const list = columns.get(key) ?? [];
    list.push(row);
    columns.set(key, list);
  }

  const nextPosition = new Map<string, number>();
  const fixes: { id: string; orderInDay: number }[] = [];

  for (const [key, list] of columns) {
    list.forEach((row, index) => {
      if (row.orderInDay !== index) fixes.push({ id: row.id, orderInDay: index });
    });
    nextPosition.set(key, list.length);
  }

  if (fixes.length > 0) {
    await prisma.$transaction(
      fixes.map((f) =>
        prisma.job.update({ where: { id: f.id }, data: { orderInDay: f.orderInDay } }),
      ),
    );
  }

  return nextPosition;
}

/**
 * Attaches a `nextDate` to each job for display on the dashboard. Prefers the
 * actual next Job row already generated for the series (source of truth) so
 * the displayed date can't drift from what auto-scheduling actually produces;
 * falls back to a calculated date when no such row exists yet.
 */
export async function attachNextDates(
  orgId: string,
  jobs: JobWithRelations[],
): Promise<JobWithNextDate[]> {
  const seriesIds = [...new Set(jobs.map((j) => j.seriesId).filter((s): s is string => Boolean(s)))];

  const futureJobs = seriesIds.length
    ? await prisma.job.findMany({
        where: { orgId, seriesId: { in: seriesIds } },
        orderBy: { scheduledDate: "asc" },
        select: { seriesId: true, scheduledDate: true },
      })
    : [];

  const bySeries = new Map<string, Date[]>();
  for (const fj of futureJobs) {
    if (!fj.seriesId) continue;
    const arr = bySeries.get(fj.seriesId) ?? [];
    arr.push(fj.scheduledDate);
    bySeries.set(fj.seriesId, arr);
  }

  return jobs.map((job) => {
    if (job.frequency === "ONE_TIME") return { ...job, nextDate: null };

    const candidates = job.seriesId ? bySeries.get(job.seriesId) ?? [] : [];
    const actualNext = candidates.find((d) => d.getTime() > job.scheduledDate.getTime()) ?? null;

    return {
      ...job,
      nextDate: actualNext ?? calculateNextOccurrenceDate(job.scheduledDate, job.frequency),
    };
  });
}
