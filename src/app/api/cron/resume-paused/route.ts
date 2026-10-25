import { prisma } from "@/lib/prisma";
import { cronAuthorized, cronUnauthorized } from "@/lib/cron-auth";
import { resumeStripeSubscription } from "@/lib/stripe/pause";

/**
 * Restarts billing for companies whose chosen resume date has arrived.
 *
 * Ours rather than a Stripe pause schedule: Stripe's scheduled resume needs a
 * subscription schedule attached, which blocks the Billing Portal's own
 * changes and adds a second object to keep in step. A daily job against a date
 * we already store is the smaller moving part.
 *
 * Idempotent without a guard column. The query only finds orgs still paused,
 * and a successful resume clears the pause fields (here and in the webhook).
 * A declined card leaves the company paused with Stripe retrying the invoice,
 * and tomorrow's run tries again; that one call failing is logged, not fatal
 * to the rest of the run.
 *
 * Runs daily from Vercel Cron (see vercel.json).
 */
export async function GET(request: Request): Promise<Response> {
  if (!cronAuthorized(request)) return cronUnauthorized();

  const due = await prisma.org.findMany({
    where: {
      subscriptionStatus: "paused",
      pauseResumesAt: { lte: new Date() },
      stripeSubscriptionId: { not: null },
    },
    select: { id: true, stripeSubscriptionId: true },
  });

  let resumed = 0;
  let stillPaused = 0;
  let failed = 0;

  for (const org of due) {
    try {
      const status = await resumeStripeSubscription(org.stripeSubscriptionId as string);
      if (status === "paused") {
        stillPaused++;
        continue;
      }
      await prisma.org.update({
        where: { id: org.id },
        data: { subscriptionStatus: status, pausedAt: null, pauseResumesAt: null },
      });
      resumed++;
    } catch (err) {
      failed++;
      console.error(
        "Scheduled resume failed for org",
        org.id,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return Response.json({ due: due.length, resumed, stillPaused, failed });
}
