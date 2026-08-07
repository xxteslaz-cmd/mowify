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
      // In this API version an invoice's subscription is not a top-level
      // field — it lives at parent.subscription_details.subscription (see
      // Stripe.Invoice.Parent.SubscriptionDetails in the installed SDK
      // types). The field that training data and older docs remember,
      // Invoice.subscription, exists only on *create params*, never on the
      // object a webhook actually delivers; reading it there always returns
      // undefined and silently drops every payment-failure notification.
      const invoice = event.data.object as Stripe.Invoice;
      const id = subscriptionId(invoice.parent?.subscription_details?.subscription);
      if (id) await mirrorSubscription(id);
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
    // Letting a cancellation failure propagate (rather than swallowing it) is
    // deliberate: the alternative is a 200 that tells Stripe to stop
    // retrying while a customer is left paying twice with no record of it.
    // Retrying is always safe here — cancelling an already-cancelled
    // subscription is a no-op on Stripe's side.
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

  // Resolved before the transaction opens, for two reasons. First, a network
  // call has no business holding a database transaction open — Stripe's
  // round trip is exactly the kind of latency an interactive transaction
  // should never wait on. Second, the id itself is already in the signed
  // event: session.subscription needs no network call to trust, so writing
  // it below does not depend on this request succeeding. Only status,
  // trial_end and the period end come from the retrieved object, and if
  // retrieval fails those simply stay null — recoverable later by any
  // subscription event, because the org is still findable by its id.
  const stripeSubscriptionId = subscriptionId(session.subscription);
  const stripeCustomerId = typeof session.customer === "string" ? session.customer : null;
  const subscription = await retrieveSubscription(session.subscription);

  // Provisioning, writing the org's billing fields, and consuming the
  // PendingSignup row all happen in one transaction. Committing the org
  // independently of consuming the row is exactly how a database fault
  // between the two produced the worst version of this bug: a retry that
  // finds the row still unconsumed, sees its own new user's email as
  // "already taken", and cancels the subscription of the org it just
  // created. Wrapping all three means a fault here rolls everything back,
  // and Stripe's retry starts from a clean slate instead of a half state.
  const result = await prisma.$transaction(async (tx) => {
    const provisioned = await createOrgWithOwner(
      {
        companyName: pending.companyName,
        name: pending.name,
        email: pending.email,
        passwordHash: pending.passwordHash as string,
      },
      tx,
    );
    if (!provisioned.ok) return provisioned;

    await tx.org.update({
      where: { id: provisioned.orgId },
      data: {
        stripeCustomerId,
        stripeSubscriptionId,
        subscriptionStatus: subscription?.status ?? null,
        trialEndsAt: toDate(subscription?.trial_end),
        currentPeriodEnd: periodEnd(subscription),
      },
    });

    await tx.pendingSignup.update({
      where: { id: pending.id },
      data: {
        orgId: provisioned.orgId,
        checkoutSessionId: session.id,
        consumedAt: new Date(),
        failedReason: null,
        // The credential has been copied onto the User row. Keeping a second
        // copy here would be a liability with no purpose.
        passwordHash: null,
      },
    });

    return provisioned;
  });

  if (!result.ok) {
    // No account can be made for this payment. During a trial no money has
    // moved, so cancelling costs the customer nothing and leaves no
    // subscription that would start charging with nothing attached to it.
    // This write is outside the transaction on purpose: when we reach here
    // the transaction above made no lasting writes (it returned before
    // touching org or pendingSignup), so there is nothing left to keep
    // atomic with it.
    console.error("Stripe webhook: provisioning failed", pending.id, result.reason);
    await prisma.pendingSignup.update({
      where: { id: pending.id },
      data: { failedReason: result.reason },
    });
    await cancelSubscription(session.subscription);
  }
}

/**
 * Re-reads the subscription from Stripe rather than trusting the event body.
 *
 * Stripe retries and can deliver events out of order, so an event describing
 * an older state could otherwise overwrite a newer one. Asking the API always
 * returns current truth, which removes the ordering problem entirely instead
 * of trying to detect it.
 */
async function mirrorSubscription(id: string): Promise<void> {
  const org = await prisma.org.findFirst({
    where: { stripeSubscriptionId: id },
    select: { id: true },
  });
  if (!org) {
    console.error("Stripe webhook: no org for subscription", id);
    return;
  }

  const subscription = await retrieveSubscription(id);
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

function subscriptionId(
  ref: string | Stripe.Subscription | null | undefined,
): string | undefined {
  return typeof ref === "string" ? ref : ref?.id;
}

/**
 * A failed retrieval degrades to null rather than throwing. This is a
 * read used only to refresh status/trial/period-end display fields — the
 * column that future webhook events key off (stripeSubscriptionId) comes
 * from the signed event itself, not from this call, so a Stripe outage here
 * costs us a stale status, never an unlinkable org.
 */
async function retrieveSubscription(
  ref: string | Stripe.Subscription | null | undefined,
): Promise<Stripe.Subscription | null> {
  const id = subscriptionId(ref);
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

/**
 * Deliberately does not catch. Swallowing a failed cancellation would answer
 * Stripe with 200 — "handled" — while a customer keeps paying for a
 * subscription attached to no account and nothing on our side records the
 * attempt. Letting the error reach the route means a 500 and a Stripe retry
 * instead, which is safe: cancelling an already-cancelled subscription is a
 * no-op on Stripe's side.
 */
async function cancelSubscription(
  ref: string | Stripe.Subscription | null | undefined,
): Promise<void> {
  const id = subscriptionId(ref);
  if (!id) return;
  await getStripe().subscriptions.cancel(id);
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
