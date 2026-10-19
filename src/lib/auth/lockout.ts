/**
 * Throttles credential guessing. This matters most for crew PINs: six digits
 * is a million combinations, which a script would otherwise exhaust quickly
 * against real customer addresses and phone numbers.
 */
export const MAX_FAILED_ATTEMPTS = 5;
// Crew PINs get fewer tries than owner passwords: six digits is a far smaller
// space, and the owner can unlock from /team in one tap.
export const CREW_MAX_FAILED_ATTEMPTS = 3;
export const LOCKOUT_MS = 15 * 60 * 1000;

export function isLocked(user: { lockedUntil: Date | null }): boolean {
  return user.lockedUntil !== null && user.lockedUntil.getTime() > Date.now();
}

export function nextLockoutState(
  failedAttempts: number,
  max: number = MAX_FAILED_ATTEMPTS,
): {
  failedAttempts: number;
  lockedUntil: Date | null;
} {
  const next = failedAttempts + 1;
  return {
    failedAttempts: next,
    lockedUntil:
      next >= max ? new Date(Date.now() + LOCKOUT_MS) : null,
  };
}

export function priorFailures(user: {
  failedAttempts: number;
  lockedUntil: Date | null;
}): number {
  // A lock that has already expired starts the count over. Otherwise one wrong
  // password long after a previous lockout would re-lock the account instantly.
  if (user.lockedUntil && user.lockedUntil.getTime() <= Date.now()) return 0;
  return user.failedAttempts;
}

export function lockoutMessage(lockedUntil: Date): string {
  const minutes = Math.max(
    1,
    Math.ceil((lockedUntil.getTime() - Date.now()) / 60_000),
  );
  return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}, or ask your manager to reset it.`;
}

/** "2 more wrong attempts will lock this account." */
export function attemptsWarning(remaining: number): string {
  return `${remaining} more wrong attempt${remaining === 1 ? "" : "s"} will lock this account.`;
}
