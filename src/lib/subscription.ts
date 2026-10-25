/**
 * The only two Stripe subscription statuses that grant full access.
 *
 * Stated as an allowlist rather than a blocklist of lapsed states: Stripe can
 * add a status, and a new one should fail closed rather than silently hand out
 * the product for free.
 */
export const ACTIVE_SUBSCRIPTION_STATUSES = ["trialing", "active"] as const;

/**
 * Statuses whose data is kept indefinitely: the 30-day deletion clock never
 * starts for them. `paused` is read-only like a lapse, but it is a company that
 * asked to come back, and deleting someone's customers while they sit out the
 * winter is the outcome pausing exists to prevent.
 */
export const RETAINED_SUBSCRIPTION_STATUSES = [
  ...ACTIVE_SUBSCRIPTION_STATUSES,
  "paused",
] as const;

export function isOrgRetained(status: string | null | undefined): boolean {
  return (RETAINED_SUBSCRIPTION_STATUSES as readonly string[]).includes(status ?? "");
}

export function isOrgActive(status: string | null | undefined): boolean {
  return (ACTIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(status ?? "");
}
