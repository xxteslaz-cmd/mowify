/**
 * Calendar dates in this app are date-only values with no time or zone.
 *
 * Prisma hands back `@db.Date` columns as UTC midnight, so every helper here
 * treats a Date as UTC midnight too, and formatting pins `timeZone: "UTC"`.
 * Reading such a value with local getters shifts it a day backwards for anyone
 * west of UTC, which is exactly the off-by-one this convention prevents.
 *
 * The one deliberate exception is `todayISO`, which must answer "what day is it
 * where the user is" and therefore reads local components.
 */

export function toISODate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseISODate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

export function addMonths(d: Date, months: number): Date {
  const copy = new Date(d);
  copy.setUTCMonth(copy.getUTCMonth() + months);
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

/** The user's current calendar day, read from their local clock. */
export function todayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Today as a UTC-midnight date, matching how stored dates are represented. */
export function todayDate(): Date {
  return parseISODate(todayISO());
}

export function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export function endOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}

/**
 * The Sunday-aligned 6x7 block of days a month calendar renders, including the
 * neighbouring-month days that pad the first and last rows. Always 42 days so
 * the grid's height doesn't jump between months.
 */
export function monthGridDays(monthAnchor: Date): Date[] {
  const first = startOfMonth(monthAnchor);
  const gridStart = addDays(first, -first.getUTCDay());
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}

export function formatDisplayDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatMonthLabel(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatShortDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
