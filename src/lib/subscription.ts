/**
 * The only two Stripe subscription statuses that grant full access.
 *
 * Stated as an allowlist rather than a blocklist of lapsed states: Stripe can
 * add a status, and a new one should fail closed rather than silently hand out
 * the product for free.
 */
export const ACTIVE_SUBSCRIPTION_STATUSES = ["trialing", "active"] as const;

export function isOrgActive(status: string | null | undefined): boolean {
  return (ACTIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(status ?? "");
}
