import "server-only";
import { getStripe } from "./client";

/**
 * The installed SDK is pinned to 2026-07-29.dahlia, which has no pause
 * endpoint, and its resume() is the older trial-only variant without
 * payment_behavior. Both calls therefore go out raw on the version that has
 * them. Only the returned `status` is read, so the response shape drifting
 * from the SDK's types cannot break anything here.
 *
 * ponytail: raw requests on a pinned version; switch to the typed methods once
 * the SDK major that ships endive is adopted.
 */
const PAUSE_API_VERSION = "2026-09-30.endive";

/**
 * Pauses now. Unused days in the current period are credited (Stripe's
 * default), and the credit lands on the resumption invoice.
 *
 * Stripe can only pause a subscription in flexible billing mode. Ones created
 * before that became the default are migrated first; the migration is a no-op
 * for billing and cannot be undone, which is fine because flexible is where
 * Stripe is taking every subscription anyway.
 */
export async function pauseStripeSubscription(
  id: string,
  pausedAt: Date,
  resumesAt: Date,
): Promise<string> {
  const stripe = getStripe();
  const sub = await stripe.subscriptions.retrieve(id);
  if (sub.billing_mode?.type === "classic") {
    await stripe.subscriptions.migrate(id, { billing_mode: { type: "flexible" } });
  }

  // Written to Stripe before pausing so the webhook mirror has the dates to
  // copy the moment the paused event arrives. Stripe is the record the org row
  // is rebuilt from, so the dates live there rather than only in our database.
  await stripe.subscriptions.update(id, {
    metadata: {
      paused_at: String(Math.floor(pausedAt.getTime() / 1000)),
      pause_resumes_at: String(Math.floor(resumesAt.getTime() / 1000)),
    },
  });

  const paused = await stripe.rawRequest(
    "POST",
    `/v1/subscriptions/${id}/pause`,
    {},
    { apiVersion: PAUSE_API_VERSION },
  );
  return (paused as { status: string }).status;
}

/**
 * resume_on_payment_success, so a declined card leaves the company paused
 * (and Stripe retrying) rather than active-but-unpaid. The billing month
 * restarts today, which is what the warning on /billing tells the owner.
 *
 * Returns the status after the call: still `paused` means the charge has not
 * gone through yet.
 */
export async function resumeStripeSubscription(id: string): Promise<string> {
  const resumed = await getStripe().rawRequest(
    "POST",
    `/v1/subscriptions/${id}/resume`,
    {
      payment_behavior: "resume_on_payment_success",
      billing_cycle_anchor: { type: "now" },
      proration_behavior: "create_prorations",
    },
    { apiVersion: PAUSE_API_VERSION },
  );
  return (resumed as { status: string }).status;
}
