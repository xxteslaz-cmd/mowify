import "server-only";
import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { createOrgWithOwner } from "@/lib/provision";
import { getStripe } from "./client";

/**
 * Applies a verified Stripe event.
 *
 * Signature verification happens in the route; by the time anything reaches
 * here the event is known to have come from Stripe. Kept separate from the
 * route so it can be tested with constructed events rather than signed HTTP.
 */
export async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      await completeSignup(event.data.object as Stripe.Checkout.Session);
      return;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await mirrorSubscription((event.data.object as Stripe.Subscription).id);
      return;
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice & {
        subscription?: string | null;
      };
      if (invoice.subscription) await mirrorSubscription(invoice.subscription);
      return;
    }
    default:
      return;
  }
}

async function completeSignup(session: Stripe.Checkout.Session): Promise<void> {
  const pendingId = session.client_reference_id;
  if (!pendingId) return;

  const pending = await prisma.pendingSignup.findUnique({
    where: { id: pendingId },
  });

  // An event for a row we do not have. Returning quietly means Stripe stops
  // retrying; the route still answers 200.
  if (!pending) {
    console.error("Stripe webhook: no pending signup", pendingId);
    return;
  }

  if (pending.consumedAt) {
    if (pending.checkoutSessionId === session.id) return; // A replay.

    // Two checkouts completed for one signup — most often somebody paid in a
    // tab they had abandoned after retrying. The account they already have
    // keeps its subscription; this second one is cancelled so it never bills.
    console.error(
      "Stripe webhook: duplicate checkout for a consumed signup",
      pending.id,
    );
    await cancelSubscription(session.subscription);
    return;
  }

  // Expiry is not checked here on purpose. Stripe confirming a card outranks
  // our own clock, and taking payment while refusing to create the account is
  // the one outcome worth any amount of code to avoid.

  if (!pending.passwordHash) {
    console.error("Stripe webhook: pending signup has no password", pending.id);
    await cancelSubscription(session.subscription);
    return;
  }

  const result = await createOrgWithOwner({
    companyName: pending.companyName,
    name: pending.name,
    email: pending.email,
    passwordHash: pending.passwordHash,
  });

  if (!result.ok) {
    // No account can be made for this payment. During a trial no money has
    // moved, so cancelling costs the customer nothing and leaves no
    // subscription that would start charging with nothing attached to it.
    console.error("Stripe webhook: provisioning failed", pending.id, result.reason);
    await prisma.pendingSignup.update({
      where: { id: pending.id },
      data: { failedReason: result.reason },
    });
    await cancelSubscription(session.subscription);
    return;
  }

  const subscription = await retrieveSubscription(session.subscription);

  await prisma.org.update({
    where: { id: result.orgId },
    data: {
      stripeCustomerId: typeof session.customer === "string" ? session.customer : null,
      stripeSubscriptionId: subscription?.id ?? null,
      subscriptionStatus: subscription?.status ?? null,
      trialEndsAt: toDate(subscription?.trial_end),
      currentPeriodEnd: periodEnd(subscription),
    },
  });

  await prisma.pendingSignup.update({
    where: { id: pending.id },
    data: {
      orgId: result.orgId,
      checkoutSessionId: session.id,
      consumedAt: new Date(),
      failedReason: null,
      // The credential has been copied onto the User row. Keeping a second
      // copy here would be a liability with no purpose.
      passwordHash: null,
    },
  });
}

/**
 * Re-reads the subscription from Stripe rather than trusting the event body.
 *
 * Stripe retries and can deliver events out of order, so an event describing
 * an older state could otherwise overwrite a newer one. Asking the API always
 * returns current truth, which removes the ordering problem entirely instead
 * of trying to detect it.
 */
async function mirrorSubscription(subscriptionId: string): Promise<void> {
  const org = await prisma.org.findFirst({
    where: { stripeSubscriptionId: subscriptionId },
    select: { id: true },
  });
  if (!org) {
    console.error("Stripe webhook: no org for subscription", subscriptionId);
    return;
  }

  const subscription = await retrieveSubscription(subscriptionId);
  if (!subscription) return;

  await prisma.org.update({
    where: { id: org.id },
    data: {
      subscriptionStatus: subscription.status,
      trialEndsAt: toDate(subscription.trial_end),
      currentPeriodEnd: periodEnd(subscription),
    },
  });
}

async function retrieveSubscription(
  ref: string | Stripe.Subscription | null | undefined,
): Promise<Stripe.Subscription | null> {
  const id = typeof ref === "string" ? ref : ref?.id;
  if (!id) return null;
  try {
    return (await getStripe().subscriptions.retrieve(id)) as Stripe.Subscription;
  } catch (err) {
    console.error(
      "Stripe webhook: could not retrieve subscription",
      id,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

async function cancelSubscription(
  ref: string | Stripe.Subscription | null | undefined,
): Promise<void> {
  const id = typeof ref === "string" ? ref : ref?.id;
  if (!id) return;
  try {
    await getStripe().subscriptions.cancel(id);
  } catch (err) {
    console.error(
      "Stripe webhook: could not cancel subscription",
      id,
      err instanceof Error ? err.message : String(err),
    );
  }
}

function toDate(seconds: number | null | undefined): Date | null {
  return seconds ? new Date(seconds * 1000) : null;
}

/**
 * The period end lives on the subscription item rather than the subscription
 * in current Stripe API versions. Read defensively so a shape change degrades
 * to a null date instead of throwing inside a webhook.
 */
function periodEnd(subscription: Stripe.Subscription | null): Date | null {
  if (!subscription) return null;
  const item = subscription.items?.data?.[0] as
    | { current_period_end?: number }
    | undefined;
  return toDate(item?.current_period_end);
}
