"use server";

import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { createSession, hashToken } from "@/lib/auth/session";
import { CLAIM_COOKIE } from "@/lib/auth/claim-cookie";
import { getStripe } from "@/lib/stripe/client";
import { handleStripeEvent } from "@/lib/stripe/handle-event";

export type ClaimState =
  | { status: "ready" }
  | { status: "pending" }
  | { status: "failed"; reason: "email-taken" | "unknown" };

/**
 * How long to wait for the webhook before asking Stripe directly.
 *
 * Stripe usually delivers in well under a second. The fallback exists for the
 * case where it does not at all: somebody who has just handed over a card and
 * has no account and no way to get one is the worst outcome this design can
 * produce, and it is worth an extra API call to make it impossible.
 */
const WEBHOOK_GRACE_MS = 5_000;

export async function claimAccount(): Promise<ClaimState> {
  const cookieStore = await cookies();
  const claim = cookieStore.get(CLAIM_COOKIE)?.value;

  // No cookie means this browser did not start the signup. Nothing here is
  // keyed on anything a visitor can supply in a URL, so there is nothing to
  // guess at.
  if (!claim) return { status: "failed", reason: "unknown" };

  let pending = await prisma.pendingSignup.findUnique({
    where: { claimHash: hashToken(claim) },
  });

  if (!pending) return { status: "failed", reason: "unknown" };

  if (!pending.consumedAt && shouldReconcile(pending.createdAt)) {
    await reconcileFromStripe(pending.checkoutSessionId);
    pending = await prisma.pendingSignup.findUnique({
      where: { claimHash: hashToken(claim) },
    });
    if (!pending) return { status: "failed", reason: "unknown" };
  }

  if (pending.failedReason) {
    return {
      status: "failed",
      reason: pending.failedReason === "email-taken" ? "email-taken" : "unknown",
    };
  }

  if (!pending.consumedAt || !pending.orgId) return { status: "pending" };

  const owner = await prisma.user.findFirst({
    where: { orgId: pending.orgId, role: "OWNER", email: pending.email },
    select: { id: true },
  });

  if (!owner) return { status: "failed", reason: "unknown" };

  await createSession(owner.id, "OWNER");

  // Single use. The claim has done its only job, and leaving it in the browser
  // would leave a second way into the account for as long as it lived.
  cookieStore.delete(CLAIM_COOKIE);

  return { status: "ready" };
}

function shouldReconcile(createdAt: Date): boolean {
  return Date.now() - createdAt.getTime() > WEBHOOK_GRACE_MS;
}

/**
 * Asks Stripe whether the checkout completed and, if so, runs exactly the same
 * handler the webhook would have.
 *
 * This is not trusting the return URL: no identifier came from the URL, the
 * session id came from our own row, and the visitor already proved they own
 * the claim cookie. The handler is idempotent, so a webhook arriving after
 * this changes nothing.
 */
async function reconcileFromStripe(
  checkoutSessionId: string | null,
): Promise<void> {
  if (!checkoutSessionId) return;

  try {
    const session = await getStripe().checkout.sessions.retrieve(checkoutSessionId);
    if (session.status !== "complete") return;

    await handleStripeEvent({
      id: `reconcile_${checkoutSessionId}`,
      type: "checkout.session.completed",
      data: { object: session },
    } as never);
  } catch (err) {
    console.error(
      "Checkout reconciliation failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
}
