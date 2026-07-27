"use server";

import { prisma } from "@/lib/prisma";
import { parseISODate, toISODate } from "@/lib/date";
import { generateNextOccurrence } from "@/lib/recurring";
import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import type { Frequency, ServiceType } from "@prisma/client";

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
  // The forms enforce this too, but a job with no crew would be invisible on
  // the board, so it can't be allowed to reach the database.
  if (!input.crewId) throw new Error("A crew is required");

  const customService =
    input.serviceType === "OTHER" ? input.customService?.trim() || null : null;
  if (input.serviceType === "OTHER" && !customService) {
    throw new Error("Describe the service when choosing Other");
  }

  let customerId = input.customerId;

  if (!customerId && input.newCustomer) {
    const customer = await prisma.customer.create({ data: input.newCustomer });
    customerId = customer.id;
  }
  if (!customerId) throw new Error("A customer is required");

  const date = parseISODate(input.dateISO);
  const crewId = input.crewId;

  const columnCount = await prisma.job.count({
    where: { scheduledDate: date, crewId },
  });

  const job = await prisma.job.create({
    data: {
      customerId,
      serviceType: input.serviceType,
      customService,
      frequency: input.frequency,
      crewId,
      scheduledDate: date,
      orderInDay: columnCount,
      seriesId:
        input.frequency === "WEEKLY" || input.frequency === "BIWEEKLY"
          ? randomUUID()
          : null,
    },
    include: { customer: true, crew: true },
  });

  revalidateAffected(input.dateISO, crewId);
  return job;
}

export async function updateJobFrequency(
  jobId: string,
  frequency: Frequency,
  dateISO: string,
  crewId: string,
) {
  const current = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });

  // Only wire up a series if this job is becoming auto-generated and isn't
  // already part of one; existing past/future occurrences in an existing
  // series are untouched since we only ever update this one row.
  const needsSeries = (frequency === "WEEKLY" || frequency === "BIWEEKLY") && !current.seriesId;

  const job = await prisma.job.update({
    where: { id: jobId },
    data: {
      frequency,
      ...(needsSeries ? { seriesId: randomUUID() } : {}),
    },
    include: { customer: true, crew: true },
  });

  revalidateAffected(dateISO, crewId);
  return job;
}

export async function createCrew(input: { name: string; color: string }) {
  const crew = await prisma.crew.create({ data: input });
  revalidatePath("/dashboard");
  return crew;
}

export async function updateCrew(
  id: string,
  input: { name?: string; color?: string; active?: boolean },
) {
  const crew = await prisma.crew.update({ where: { id }, data: input });
  revalidatePath("/dashboard");
  revalidatePath(`/crew/${id}/today`);
  return crew;
}

export async function deleteCrew(id: string) {
  // The UI disables Delete for crews with jobs, but re-check here since the
  // count the client rendered can be stale by the time the action runs.
  const jobCount = await prisma.job.count({ where: { crewId: id } });
  if (jobCount > 0) {
    throw new Error(
      `Cannot delete crew: ${jobCount} job${jobCount === 1 ? "" : "s"} still assigned to it.`,
    );
  }

  await prisma.crew.delete({ where: { id } });
  revalidatePath("/dashboard");
}

export async function reorderColumn(input: {
  dateISO: string;
  crewId: string;
  orderedJobIds: string[];
}) {
  const date = parseISODate(input.dateISO);
  await prisma.$transaction(
    input.orderedJobIds.map((id, index) =>
      prisma.job.update({
        where: { id },
        data: { crewId: input.crewId, orderInDay: index, scheduledDate: date },
      }),
    ),
  );
  revalidateAffected(input.dateISO, input.crewId);
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
  const newDate = parseISODate(input.newDateISO);
  await prisma.job.updateMany({
    where: { id: { in: input.jobIds }, status: { in: ["SCHEDULED", "RESCHEDULED"] } },
    data: { scheduledDate: newDate, status: "RESCHEDULED" },
  });
  revalidatePath("/dashboard");
  const crews = await prisma.job.findMany({
    where: { id: { in: input.jobIds } },
    select: { crewId: true },
    distinct: ["crewId"],
  });
  for (const c of crews) {
    if (c.crewId) revalidatePath(`/crew/${c.crewId}/today`);
  }
}

export async function deleteJob(jobId: string, dateISO: string, crewId: string) {
  await prisma.job.delete({ where: { id: jobId } });
  revalidateAffected(dateISO, crewId);
}
