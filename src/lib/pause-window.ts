/**
 * The off-season pause rules, shared by the /billing form (to draw the date
 * picker) and the server actions (to enforce it). Pure on purpose: no Stripe,
 * no database, so the boundaries can be tested directly.
 *
 * At least a month, so pausing cannot be used to skip a renewal and come
 * straight back. At most six, which covers a northern winter; anything longer
 * is a cancellation and should be one.
 */
export const MIN_PAUSE_MONTHS = 1;
export const MAX_PAUSE_MONTHS = 6;

/** Calendar months in UTC, clamped so Jan 31 + 1 month is Feb 28, not Mar 3. */
export function addMonths(date: Date, months: number): Date {
  const out = new Date(date);
  const day = out.getUTCDate();
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0),
  ).getUTCDate();
  out.setUTCDate(Math.min(day, lastDay));
  return out;
}

/** YYYY-MM-DD, the value format of <input type="date">. */
export function toDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function resumeDateLimits(now: Date): { min: string; max: string } {
  return {
    min: toDateInput(addMonths(now, MIN_PAUSE_MONTHS)),
    max: toDateInput(addMonths(now, MAX_PAUSE_MONTHS)),
  };
}

/**
 * The owner's chosen date as midnight UTC, or null when it is malformed or
 * outside the window. Compared as YYYY-MM-DD strings, which sort correctly and
 * sidestep the time of day the request happened to arrive at.
 */
export function parseResumeDate(value: string, now: Date): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || toDateInput(date) !== value) return null;
  const { min, max } = resumeDateLimits(now);
  return value >= min && value <= max ? date : null;
}

/** When a paused company may resume ahead of its chosen date. */
export function earliestEarlyResume(pausedAt: Date): Date {
  return addMonths(pausedAt, MIN_PAUSE_MONTHS);
}
