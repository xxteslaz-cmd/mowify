export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseISODate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function addMonths(d: Date, months: number): Date {
  const copy = new Date(d);
  copy.setMonth(copy.getMonth() + months);
  return copy;
}

/**
 * Single source of truth for "how far out is the next occurrence" so the
 * recurring-generation job and the dashboard's "Next:" display can't drift
 * apart. Pure (no DB access) so it's safe to call from client components too.
 */
export function calculateNextOccurrenceDate(
  scheduledDate: Date,
  frequency: "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "ONE_TIME",
): Date | null {
  switch (frequency) {
    case "WEEKLY":
      return addDays(scheduledDate, 7);
    case "BIWEEKLY":
      return addDays(scheduledDate, 14);
    case "MONTHLY":
      return addMonths(scheduledDate, 1);
    case "ONE_TIME":
      return null;
  }
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function formatDisplayDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
