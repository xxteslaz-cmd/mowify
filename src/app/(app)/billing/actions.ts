"use server";

import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth/dal";
import { getStripe } from "@/lib/stripe/client";
import { stripeConfig } from "@/lib/stripe/config";
import { isOrgActive } from "@/lib/subscription";
import { requireAppUrl } from "@/lib/url";

export type PortalResult = { url: string } | { error: string };

/**
 * Opens Stripe's hosted billing portal, where a customer updates their card,
 * reads invoices and cancels. We build none of that ourselves.
 *
 * requireOwner and not requireActiveOrg: this is the screen a lapsed account
 * uses to stop being lapsed, so gating it would make lapsing unrecoverable.
 */
export async function openBillingPortal(): Promise<PortalResult> {
  const { orgId } = await requireOwner();

  const org = await prisma.org.findUnique({
    where: { id: orgId },
    select: { stripeCustomerId: true },
  });

  if (!org?.stripeCustomerId) {
    return { error: "This company has no billing account yet." };
  }

  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: org.stripeCustomerId,
      return_url: stripeConfig().portalReturnUrl,
    });
    return { url: session.url };
  } catch (err) {
    console.error(
      "Billing portal unavailable:",
      err instanceof Error ? err.message : String(err),
    );
    return { error: "We could not open billing right now. Please try again." };
  }
}

/**
 * Opens Checkout for a company that has no live subscription, so a lapsed or
 * cancelled account can start paying again.
 *
 * The Billing Portal cannot do this. Per Stripe, "cancelled subscriptions do
 * not appear in the portal. A new subscription needs to be created" — its
 * reactivation affordance exists only while cancel_at_period_end is set and the
 * period has not yet elapsed. Once the status is `canceled` the customer has no
 * subscription for the portal to show, so openBillingPortal() above lands them
 * on a screen that cannot restart anything. That dead end is why this exists.
 *
 * requireOwner and not requireActiveOrg, for the same reason as the portal
 * action: this is the screen a lapsed account uses to stop being lapsed.
 */
export async function startResubscribe(): Promise<PortalResult> {
  const { orgId, userId } = await requireOwner();

  const org = await prisma.org.findUnique({
    where: { id: orgId },
    select: { stripeCustomerId: true, subscriptionStatus: true },
  });

  if (!org) return { error: "This company no longer exists." };

  // A courtesy check, not the real guard. This and the customer's payment are
  // seconds apart, and Stripe is the only party that knows whether money has
  // moved in between — so the webhook carries the protection that actually
  // prevents a double subscription. This just keeps the obvious case off
  // Stripe entirely.
  if (isOrgActive(org.subscriptionStatus)) {
    return { error: "This company already has an active subscription." };
  }

  // Needed only when there is no Stripe customer yet — a company grandfathered
  // in before billing existed. Without it Checkout would open with an empty
  // email field for someone who is already signed in.
  const owner = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });

  try {
    const session = await getStripe().checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: stripeConfig().priceId, quantity: 1 }],
      // No trial_period_days. Stripe will hand the same customer a second trial
      // without complaint — "it is the responsibility of your system to
      // implement a check" — so omitting it is the check. Terms section 3 sells
      // one trial per company, and a granted second one would make
      // cancel-and-restart an unlimited free plan.
      payment_method_collection: "always",
      // Reuse the existing customer so the card, the invoice history and the
      // tax details stay on one record. When it is null the company predates
      // billing entirely, and Stripe creates the customer from this email.
      ...(org.stripeCustomerId
        ? { customer: org.stripeCustomerId }
        : owner?.email
          ? { customer_email: owner.email }
          : {}),
      // How the webhook finds its way back to this org. The new subscription's
      // id is not on any Org row yet, so the usual lookup by
      // stripeSubscriptionId cannot resolve it.
      subscription_data: { metadata: { orgId } },
      // Straight back to /billing, not /billing/return. That route exists to
      // identify a visitor who has no session yet, from the claim cookie alone.
      // A resubscribing owner is already signed in, so reusing it would add a
      // second way to claim an org for no benefit.
      success_url: `${requireAppUrl()}/billing?restarted=1`,
      cancel_url: `${requireAppUrl()}/billing`,
    });

    if (!session.url) {
      return { error: "We could not start checkout. Please try again." };
    }
    return { url: session.url };
  } catch (err) {
    // Returned, never thrown: production React redacts a thrown Server Action
    // message and the owner sees boilerplate instead of the reason.
    console.error(
      "Resubscribe checkout not created:",
      err instanceof Error ? err.message : String(err),
    );
    return { error: "We could not start checkout. Please try again." };
  }
}
