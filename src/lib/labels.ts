import type { Frequency, ServiceType } from "@prisma/client";

/**
 * Single source of truth for how the ServiceType and Frequency enums are
 * offered in pickers and displayed. Prisma's enum values are SCREAMING_SNAKE
 * and must never reach the UI directly.
 */

export const SERVICE_TYPES: ServiceType[] = ["MOW", "MULCH", "CLEANUP", "OTHER"];

export const SERVICE_LABEL: Record<ServiceType, string> = {
  MOW: "Mow",
  MULCH: "Mulch",
  CLEANUP: "Cleanup",
  OTHER: "Other",
};

export const FREQUENCIES: Frequency[] = ["ONE_TIME", "WEEKLY", "BIWEEKLY", "MONTHLY"];

export const FREQUENCY_LABEL: Record<Frequency, string> = {
  ONE_TIME: "One-time",
  WEEKLY: "Weekly",
  BIWEEKLY: "Bi-weekly",
  MONTHLY: "Monthly",
};

/**
 * What a job's service should read as. An OTHER job carries its own typed-in
 * name, which stands in for the generic "Other" label everywhere it's shown.
 */
export function serviceLabel(job: {
  serviceType: ServiceType;
  customService?: string | null;
}): string {
  if (job.serviceType === "OTHER" && job.customService?.trim()) {
    return job.customService.trim();
  }
  return SERVICE_LABEL[job.serviceType];
}
