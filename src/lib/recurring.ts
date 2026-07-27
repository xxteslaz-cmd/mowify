import { prisma } from "./prisma";
import { addDays } from "./date";
import type { Job } from "@prisma/client";

const INTERVAL_DAYS: Partial<Record<Job["frequency"], number>> = {
  WEEKLY: 7,
  BIWEEKLY: 14,
};

/**
 * When a recurring occurrence is resolved (completed or skipped), create the
 * next occurrence in its series so the owner never has to re-enter it.
 * Idempotent: won't duplicate if the next date already has a job for this series.
 */
export async function generateNextOccurrence(job: Job) {
  const interval = INTERVAL_DAYS[job.frequency];
  if (!interval || !job.seriesId) return null;

  const nextDate = addDays(job.scheduledDate, interval);

  const existing = await prisma.job.findFirst({
    where: { seriesId: job.seriesId, scheduledDate: nextDate },
  });
  if (existing) return existing;

  return prisma.job.create({
    data: {
      customerId: job.customerId,
      crewId: job.crewId,
      serviceType: job.serviceType,
      frequency: job.frequency,
      scheduledDate: nextDate,
      orderInDay: job.orderInDay,
      seriesId: job.seriesId,
      status: "SCHEDULED",
    },
  });
}
