"use server";

import { prisma } from "@/lib/prisma";
import { addDays, parseISODate, toISODate } from "@/lib/date";
import {
  generateNextOccurrence,
  ensureOccurrencesThrough,
  horizonDate,
  isRecurring,
} from "@/lib/recurring";
import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import type { Frequency, ServiceType } from "@prisma/client";
import { requireOwner } from "@/lib/auth/dal";

function revalidateAffected(dateISO: string, crewId?: string | null) {
  revalidatePath("/dashboard");
  if (crewId) revalidatePath(`/crew/${crewId}/today`);
}

export async function createJob(input: {
  customerId?: string;
  newCustomer?: { name: string; address: string; phone?: string; notes?: string };
  serviceType: ServiceType;
  customService?: string | null;
  frequency: Frequency;
  dateISO: string;
  crewId: string;
}) {
  const { orgId } = await requireOwner();

  // The forms enforce this too, but a job with no crew would be invisible on
  // the board, so it can't be allowed to reach the database.
  if (!input.crewId) throw new Error("A crew is required");

  // The client picked this crew, so confirm it's actually this org's before
  // attaching it — otherwise a forged id from another company would leak
  // that crew's name and colour onto this board, and leave the other
  // company unable to delete a crew it believes has no jobs on it.
  const ownedCrew = await prisma.crew.count({ where: { id: input.crewId, orgId } });
  if (ownedCrew === 0) throw new Error("A crew is required");

  const customService =
    input.serviceType === "OTHER" ? input.customService?.trim() || null : null;
  if (input.serviceType === "OTHER" && !customService) {
    throw new Error("Describe the service when choosing Other");
  }

  let customerId = input.customerId;

  if (customerId) {
    // The client picked an existing customer, so confirm it's actually this
    // org's before attaching it — otherwise a forged id from another company
    // would leak that company's customer onto this board.
    const owned = await prisma.customer.count({ where: { id: customerId, orgId } });
    if (owned === 0) throw new Error("A customer is required");
  }

  if (!customerId && input.newCustomer) {
    const customer = await prisma.customer.create({ data: { ...input.newCustomer, orgId } });
    customerId = customer.id;
  }
  if (!customerId) throw new Error("A customer is required");

  const date = parseISODate(input.dateISO);
  const crewId = input.crewId;

  const columnCount = await prisma.job.count({
    where: { orgId, scheduledDate: date, crewId },
  });

  const job = await prisma.job.create({
    data: {
      orgId,
      customerId,
      serviceType: input.serviceType,
      customService,
      frequency: input.frequency,
      crewId,
      scheduledDate: date,
      orderInDay: columnCount,
      seriesId: isRecurring(input.frequency) ? randomUUID() : null,
    },
    include: { customer: true, crew: true },
  });

  // Fill in the upcoming visits straight away so they're on the board the
  // moment the job is created, not only once this one is completed.
  if (isRecurring(input.frequency)) {
    await ensureOccurrencesThrough(orgId, horizonDate());
  }

  revalidateAffected(input.dateISO, crewId);
  return job;
}

export async function updateJobFrequency(
  jobId: string,
  frequency: Frequency,
  dateISO: string,
  crewId: string,
) {
  const { orgId } = await requireOwner();

  const current = await prisma.job.findFirst({ where: { id: jobId, orgId } });
  if (!current) throw new Error("Job not found");

  // Only wire up a series if this job is becoming auto-generated and isn't
  // already part of one; existing past/future occurrences in an existing
  // series are untouched since we only ever update this one row.
  const needsSeries = isRecurring(frequency) && !current.seriesId;

  // updateMany rather than update: it takes a non-unique where clause, so a
  // job id from another company matches zero rows instead of updating it.
  await prisma.job.updateMany({
    where: { id: jobId, orgId },
    data: {
      frequency,
      ...(needsSeries ? { seriesId: randomUUID() } : {}),
    },
  });

  const job = await prisma.job.findFirst({
    where: { id: jobId, orgId },
    include: { customer: true, crew: true },
  });
  if (!job) throw new Error("Job not found");

  if (isRecurring(frequency)) {
    await ensureOccurrencesThrough(orgId, horizonDate());
  }

  revalidateAffected(dateISO, crewId);
  return job;
}

/**
 * Edits a job's date, crew and notes.
 *
 * `scope: "future"` carries the change onto every later visit in the series,
 * with a date change shifting them all by the same number of days so the
 * cadence is preserved. Visits already completed or skipped are left alone —
 * an edit shouldn't rewrite what a crew already did.
 */
export async function updateJob(input: {
  jobId: string;
  dateISO: string;
  crewId: string;
  notes?: string | null;
  scope: "this" | "future";
}) {
  const { orgId } = await requireOwner();

  if (!input.crewId) throw new Error("A crew is required");

  // The client picked this crew, so confirm it's actually this org's before
  // moving the job onto it — otherwise a forged id from another company
  // would leak that crew's name and colour onto this board, and leave the
  // other company unable to delete a crew it believes has no jobs on it.
  const ownedCrew = await prisma.crew.count({ where: { id: input.crewId, orgId } });
  if (ownedCrew === 0) throw new Error("A crew is required");

  const current = await prisma.job.findFirst({ where: { id: input.jobId, orgId } });
  if (!current) throw new Error("Job not found");
  const newDate = parseISODate(input.dateISO);
  const notes = input.notes?.trim() || null;

  if (input.scope === "future" && current.seriesId) {
    // Both dates are UTC midnight, so a plain millisecond difference is an
    // exact whole number of days.
    const dayDelta = Math.round(
      (newDate.getTime() - current.scheduledDate.getTime()) / 86_400_000,
    );

    // Scoped by orgId so a series id colliding across two companies (it can't
    // in practice, but nothing enforces that at the database level) never
    // matches a row that belongs to someone else.
    const later = await prisma.job.findMany({
      where: {
        orgId,
        seriesId: current.seriesId,
        scheduledDate: { gt: current.scheduledDate },
        status: { in: ["SCHEDULED", "RESCHEDULED"] },
      },
      select: { id: true, scheduledDate: true },
    });

    if (later.length > 0) {
      await prisma.$transaction(
        later.map((j) =>
          prisma.job.updateMany({
            where: { id: j.id, orgId },
            data: {
              crewId: input.crewId,
              notes,
              ...(dayDelta === 0
                ? {}
                : { scheduledDate: addDays(j.scheduledDate, dayDelta) }),
            },
          }),
        ),
      );
    }
  }

  // Land at the bottom of whichever column it now belongs to.
  const columnCount = await prisma.job.count({
    where: { orgId, scheduledDate: newDate, crewId: input.crewId, id: { not: input.jobId } },
  });

  // updateMany rather than update: it takes a non-unique where clause, so a
  // job id from another company matches zero rows instead of updating it.
  await prisma.job.updateMany({
    where: { id: input.jobId, orgId },
    data: {
      scheduledDate: newDate,
      crewId: input.crewId,
      notes,
      orderInDay: columnCount,
    },
  });

  const job = await prisma.job.findFirst({
    where: { id: input.jobId, orgId },
    include: { customer: true, crew: true },
  });
  if (!job) throw new Error("Job not found");

  revalidateAffected(toISODate(current.scheduledDate), current.crewId);
  revalidateAffected(input.dateISO, input.crewId);
  return job;
}

export async function createCrew(input: { name: string; color: string }) {
  const { orgId } = await requireOwner();
  const crew = await prisma.crew.create({ data: { ...input, orgId } });
  revalidatePath("/dashboard");
  return crew;
}

export async function updateCrew(
  id: string,
  input: { name?: string; color?: string; active?: boolean },
) {
  const { orgId } = await requireOwner();
  // updateMany rather than update: it takes a non-unique where clause, so a
  // crew id from another company matches zero rows instead of updating it.
  // This means the row can no longer be returned to the caller (updateMany
  // only reports a count), so callers must not rely on a return value here.
  await prisma.crew.updateMany({ where: { id, orgId }, data: input });
  revalidatePath("/dashboard");
  revalidatePath(`/crew/${id}/today`);
}

export async function deleteCrew(id: string) {
  const { orgId } = await requireOwner();
  // The UI disables Delete for crews with jobs, but re-check here since the
  // count the client rendered can be stale by the time the action runs.
  const jobCount = await prisma.job.count({ where: { crewId: id, orgId } });
  if (jobCount > 0) {
    throw new Error(
      `Cannot delete crew: ${jobCount} job${jobCount === 1 ? "" : "s"} still assigned to it.`,
    );
  }

  await prisma.crew.deleteMany({ where: { id, orgId } });
  revalidatePath("/dashboard");
}

/**
 * Swaps a job with its neighbour in the same crew's day, which is what drives
 * the numbered stop list on the crew's phone view.
 *
 * The whole column is rewritten to sequential positions rather than just the
 * two rows swapped, so duplicate or gappy orderInDay values can't accumulate.
 */
export async function moveJobInColumn(input: {
  jobId: string;
  direction: "up" | "down";
}) {
  const { orgId } = await requireOwner();

  const job = await prisma.job.findFirst({ where: { id: input.jobId, orgId } });
  if (!job) throw new Error("Job not found");

  const column = await prisma.job.findMany({
    where: { orgId, scheduledDate: job.scheduledDate, crewId: job.crewId },
    // createdAt breaks ties so the order is stable when positions collide.
    orderBy: [{ orderInDay: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });

  const index = column.findIndex((j) => j.id === job.id);
  const target = input.direction === "up" ? index - 1 : index + 1;
  if (index === -1 || target < 0 || target >= column.length) return;

  const reordered = [...column];
  [reordered[index], reordered[target]] = [reordered[target], reordered[index]];

  await prisma.$transaction(
    reordered.map((j, i) =>
      prisma.job.updateMany({ where: { id: j.id, orgId }, data: { orderInDay: i } }),
    ),
  );

  revalidateAffected(toISODate(job.scheduledDate), job.crewId);
}

export async function updateJobStatus(jobId: string, status: "COMPLETED" | "SKIPPED") {
  const job = await prisma.job.update({
    where: { id: jobId },
    data: { status },
  });

  await generateNextOccurrence(job);

  revalidateAffected(toISODate(job.scheduledDate), job.crewId);
}

export async function bulkRescheduleDay(input: {
  dateISO: string;
  newDateISO: string;
  jobIds: string[];
}) {
  const { orgId } = await requireOwner();
  const newDate = parseISODate(input.newDateISO);
  await prisma.job.updateMany({
    where: {
      orgId,
      id: { in: input.jobIds },
      status: { in: ["SCHEDULED", "RESCHEDULED"] },
    },
    data: { scheduledDate: newDate, status: "RESCHEDULED" },
  });
  revalidatePath("/dashboard");
  const crews = await prisma.job.findMany({
    where: { orgId, id: { in: input.jobIds } },
    select: { crewId: true },
    distinct: ["crewId"],
  });
  for (const c of crews) {
    if (c.crewId) revalidatePath(`/crew/${c.crewId}/today`);
  }
}

export async function deleteJob(jobId: string, dateISO: string, crewId: string) {
  const { orgId } = await requireOwner();
  // deleteMany rather than delete: it takes a non-unique where clause, so a
  // job id from another company matches zero rows instead of deleting it.
  await prisma.job.deleteMany({ where: { id: jobId, orgId } });
  revalidateAffected(dateISO, crewId);
}
