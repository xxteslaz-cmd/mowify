import { prisma } from "./prisma";
import { calculateNextOccurrenceDate } from "./date";
import type { Job } from "@prisma/client";
import type { JobWithRelations, JobWithNextDate } from "./types";

const AUTO_GENERATED_FREQUENCIES: Job["frequency"][] = ["WEEKLY", "BIWEEKLY"];

/**
 * When a recurring occurrence is resolved (completed or skipped), create the
 * next occurrence in its series so the owner never has to re-enter it.
 * Idempotent: won't duplicate if the next date already has a job for this series.
 */
export async function generateNextOccurrence(job: Job) {
  if (!AUTO_GENERATED_FREQUENCIES.includes(job.frequency) || !job.seriesId) return null;

  const nextDate = calculateNextOccurrenceDate(job.scheduledDate, job.frequency)!;

  const existing = await prisma.job.findFirst({
    where: { seriesId: job.seriesId, scheduledDate: nextDate },
  });
  if (existing) return existing;

  return prisma.job.create({
    data: {
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
 * Attaches a `nextDate` to each job for display on the dashboard. Prefers the
 * actual next Job row already generated for the series (source of truth) so
 * the displayed date can't drift from what auto-scheduling actually produces;
 * falls back to a calculated date when no such row exists yet.
 */
export async function attachNextDates(jobs: JobWithRelations[]): Promise<JobWithNextDate[]> {
  const seriesIds = [...new Set(jobs.map((j) => j.seriesId).filter((s): s is string => Boolean(s)))];

  const futureJobs = seriesIds.length
    ? await prisma.job.findMany({
        where: { seriesId: { in: seriesIds } },
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
