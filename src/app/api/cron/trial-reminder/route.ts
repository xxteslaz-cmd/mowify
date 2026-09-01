import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email/client";
import { trialEndingEmail } from "@/lib/email/templates";
import { pricePerInterval } from "@/lib/pricing";
import { appUrl } from "@/lib/url";

/**
 * Emails owners seven days before their trial converts.
 *
 * Terms section 3 promises this in specific terms — "a reminder at least 7 days
 * before the trial ends, telling you the date the charge will occur, the
 * amount, and how to cancel" — which is why it is a scheduled job rather than a
 * webhook handler. Stripe's own `customer.subscription.trial_will_end` fires
 * exactly three days out and the timing is not configurable; Stripe's guidance
 * on sending earlier is "Currently not supported through Stripe." Three days is
 * not seven, so the promise has to be kept from here.
 *
 * Runs daily from Vercel Cron (see vercel.json).
 */

/** How far ahead to look. See the window comment in the query below. */
const WINDOW_DAYS = 8;

export async function GET(request: Request): Promise<Response> {
  if (!authorized(request)) {
    // 404 rather than 401. A 401 confirms the route exists to anyone probing,
    // and there is nothing to gain from telling them.
    return new Response(null, { status: 404 });
  }

  const now = new Date();
  const horizon = new Date(now.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const orgs = await prisma.org.findMany({
    where: {
      subscriptionStatus: "trialing",
      // The idempotence guard. Cron can double-fire, a run can overlap a
      // deploy, and a failed invocation is retried — none of which may mail
      // the same owner twice.
      trialReminderSentAt: null,
      trialEndsAt: { gt: now, lte: horizon },
    },
    select: {
      id: true,
      trialEndsAt: true,
      // Crew have no email by design, so the owner is the only possible
      // recipient. `active` excludes an owner whose access has been revoked.
      users: {
        where: { role: "OWNER", active: true, email: { not: null } },
        select: { email: true },
        take: 1,
      },
    },
  });

  let sent = 0;
  let failed = 0;

  for (const org of orgs) {
    const email = org.users[0]?.email;
    if (!email || !org.trialEndsAt) continue;

    const { subject, html } = trialEndingEmail({
      chargeDate: formatChargeDate(org.trialEndsAt),
      amount: pricePerInterval(),
      billingUrl: appUrl("/billing"),
    });

    const ok = await sendEmail({ to: email, subject, html });

    if (!ok) {
      // sendEmail never throws — it logs and returns false. Marking the row
      // regardless would consume the one reminder this company gets on a
      // provider outage, and the failure would be invisible: an unset
      // RESEND_API_KEY returns false in exactly the same way a real outage
      // does. Leaving the column null means tomorrow's run tries again, and
      // the eight-day window is wide enough to absorb that.
      failed++;
      continue;
    }

    await prisma.org.update({
      where: { id: org.id },
      data: { trialReminderSentAt: new Date() },
    });
    sent++;
  }

  return Response.json({ considered: orgs.length, sent, failed });
}

/**
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
 *
 * Fails closed when CRON_SECRET is unset. The alternative — treating an absent
 * secret as "no auth required" — would leave a route that mails every trialing
 * customer open to anyone who guesses the path, and it would do so precisely
 * when the environment is misconfigured and nobody is watching.
 */
function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("CRON_SECRET is not set; refusing to run the trial reminder.");
    return false;
  }

  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return false;

  // Constant-time, so the response time does not leak how much of the secret
  // was correct. The lengths must match first — timingSafeEqual throws on
  // mismatched buffers.
  const provided = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(secret);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

/** e.g. "12 September 2026" — unambiguous, unlike any all-numeric format. */
function formatChargeDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
