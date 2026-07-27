import type { Prisma } from "@prisma/client";

export type JobWithRelations = Prisma.JobGetPayload<{
  include: { customer: true; crew: true };
}>;

export type JobWithNextDate = JobWithRelations & { nextDate: Date | null };

export type JobWithCustomer = Prisma.JobGetPayload<{
  include: { customer: true };
}>;

export type JobWithCrew = Prisma.JobGetPayload<{
  include: { crew: true };
}>;

export type CustomerWithJobs = Prisma.CustomerGetPayload<{
  include: { jobs: { include: { crew: true } } };
}>;
