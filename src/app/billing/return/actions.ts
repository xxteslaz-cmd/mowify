"use server";

import { randomBytes } from "crypto";
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

  const claimHash = hashToken(claim);

  let pending = await findLiveClaim(claimHash);

  if (!pending) return { status: "failed", reason: "unknown" };

  // Checked before the reconcile, not after. A permanently failed row can never
  // become good, so re-running the reconcile against it only bought a Stripe
  // session retrieve, a subscription retrieve, another doomed provisioning
  // attempt and another cancelSubscription call — every 1.5 seconds, for the
  // whole sixty-second poll window.
  if (pending.failedReason) return failure(pending.failedReason);

  if (!pending.consumedAt && shouldReconcile(pending.createdAt)) {
    await reconcileFromStripe(pending.checkoutSessionId);
    pending = await findLiveClaim(claimHash);
    if (!pending) return { status: "failed", reason: "unknown" };
    if (pending.failedReason) return failure(pending.failedReason);
  }

  if (!pending.consumedAt || !pending.orgId) return { status: "pending" };

  const owner = await prisma.user.findFirst({
    where: { orgId: pending.orgId, role: "OWNER", email: pending.email },
    select: { id: true },
  });

  if (!owner) return { status: "failed", reason: "unknown" };

  // Invalidate the claim before opening the session, atomically with the
  // read that proved it was still live: the WHERE clause requires claimHash
  // to still equal the value just looked up, so this update is a
  // compare-and-swap. A second request racing on the same cookie value (a
  // double-poll, or the same stolen value replayed later) finds count 0 and
  // must not proceed to mint its own session.
  //
  // Rotating to a fresh, discarded random hash — rather than clearing the
  // column — is what makes this a real revocation. Without it, `claimAccount`
  // never consulted anything but claimHash and never invalidated it: the
  // browser's cookie being deleted is only an instruction to the browser, so
  // anyone who had captured the raw claim value once (a synced profile, a
  // backup, an XSS) could keep presenting it and mint a fresh owner session
  // forever. Nothing in the product — a password change, "sign out
  // everywhere" — could ever revoke it. Rotating the hash here means the
  // value is dead the instant it is spent, no matter who still holds it.
  const invalidated = await prisma.pendingSignup.updateMany({
    where: { id: pending.id, claimHash },
    data: { claimHash: hashToken(randomBytes(32).toString("base64url")) },
  });
  if (invalidated.count === 0) return { status: "failed", reason: "unknown" };

  await createSession(owner.id, "OWNER");

  // Also clear the cookie in this browser. Redundant with the rotation above
  // for security — the value is already dead — but there is no reason to
  // leave a spent token sitting in the browser either.
  cookieStore.delete(CLAIM_COOKIE);

  return { status: "ready" };
}

/**
 * Looks up a claim by hash, rejecting rows whose expiry has passed.
 *
 * The signup sweep in `signup/actions.ts` only deletes unconsumed rows, and
 * only once they are well past expiry — a consumed row is deliberately left
 * behind as a record, and would otherwise carry a live claimHash forever.
 * Filtering on expiresAt here, independent of
 * whether the row was ever consumed, caps how long a captured claim value
 * stays usable at the 48-hour TTL it was minted with, whether or not
 * anything ever sweeps the row.
 */
function findLiveClaim(claimHash: string) {
  return prisma.pendingSignup.findFirst({
    where: { claimHash, expiresAt: { gt: new Date() } },
  });
}

function failure(reason: string): ClaimState {
  return {
    status: "failed",
    reason: reason === "email-taken" ? "email-taken" : "unknown",
  };
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
