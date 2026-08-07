"use server";

import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth/dal";
import { getStripe } from "@/lib/stripe/client";
import { stripeConfig } from "@/lib/stripe/config";

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
