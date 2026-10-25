"use server";

import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth/dal";
import { getStripe } from "@/lib/stripe/client";
import { stripeConfig } from "@/lib/stripe/config";
import { isOrgActive } from "@/lib/subscription";
import { requireAppUrl } from "@/lib/url";
import { earliestEarlyResume, parseResumeDate } from "@/lib/pause-window";
import { pauseStripeSubscription, resumeStripeSubscription } from "@/lib/stripe/pause";

export type PortalResult = { url: string } | { error: string };
export type ActionResult = { ok: true } | { error: string };

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
  // A paused subscription is still live on Stripe's side and resumes on its
  // own. A second one alongside it would bill this company twice.
  if (org.subscriptionStatus === "paused") {
    return { error: "Your subscription is paused. Resume it instead." };
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

function longDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Pauses an active, paid subscription until a date the owner picks, one to six
 * months out (see pause-window.ts). The account goes read-only, nothing is
 * billed, and the resume-paused cron restarts billing on that date.
 *
 * Trials are refused. Stripe will not pause one anyway, and allowing it here
 * would let a 30-day trial be stretched across a season.
 */
export async function pauseSubscription(resumeDate: string): Promise<ActionResult> {
  const { orgId } = await requireOwner();

  const org = await prisma.org.findUnique({
    where: { id: orgId },
    select: { stripeSubscriptionId: true, subscriptionStatus: true },
  });

  if (!org?.stripeSubscriptionId || org.subscriptionStatus !== "active") {
    return {
      error: "Only an active, paid subscription can be paused. Free trials can't be.",
    };
  }

  const now = new Date();
  const resumesAt = parseResumeDate(resumeDate, now);
  if (!resumesAt) {
    return { error: "Pick a resume date between one and six months from today." };
  }

  try {
    const status = await pauseStripeSubscription(org.stripeSubscriptionId, now, resumesAt);
    // Written now so /billing shows the pause on the redirect back. The
    // webhook writes the same values from Stripe a moment later.
    const paused = status === "paused";
    await prisma.org.update({
      where: { id: orgId },
      data: {
        subscriptionStatus: status,
        pausedAt: paused ? now : null,
        pauseResumesAt: paused ? resumesAt : null,
      },
    });
    return { ok: true };
  } catch (err) {
    console.error(
      "Pause failed:",
      err instanceof Error ? err.message : String(err),
    );
    return { error: "We could not pause your subscription. Please try again." };
  }
}

/**
 * Ends a pause early. Held back until the pause is a month old, so pausing
 * cannot be used to dodge a renewal and return straight away.
 *
 * A pause with no pausedAt was made outside the app (the Stripe Dashboard),
 * where we promised no minimum, so it is allowed through.
 */
export async function resumeSubscription(): Promise<ActionResult> {
  const { orgId } = await requireOwner();

  const org = await prisma.org.findUnique({
    where: { id: orgId },
    select: { stripeSubscriptionId: true, subscriptionStatus: true, pausedAt: true },
  });

  if (!org?.stripeSubscriptionId || org.subscriptionStatus !== "paused") {
    return { error: "This subscription isn't paused." };
  }

  if (org.pausedAt) {
    const earliest = earliestEarlyResume(org.pausedAt);
    if (new Date() < earliest) {
      return {
        error: `Pauses last at least a month. You can resume from ${longDate(earliest)}.`,
      };
    }
  }

  try {
    const status = await resumeStripeSubscription(org.stripeSubscriptionId);
    if (status === "paused") {
      return {
        error:
          "Your card didn't go through, so you're still paused. Update it under Manage billing, then try again.",
      };
    }
    await prisma.org.update({
      where: { id: orgId },
      data: { subscriptionStatus: status, pausedAt: null, pauseResumesAt: null },
    });
    return { ok: true };
  } catch (err) {
    console.error(
      "Resume failed:",
      err instanceof Error ? err.message : String(err),
    );
    return { error: "We could not resume your subscription. Please try again." };
  }
}
