import { prisma } from "@/lib/prisma";
import { cronAuthorized, cronUnauthorized } from "@/lib/cron-auth";
import { RETENTION } from "@/lib/legal";
import { ACTIVE_SUBSCRIPTION_STATUSES } from "@/lib/subscription";

/**
 * Deletes the data of companies that lapsed more than 30 days ago, and consent
 * records that have outlived their own retention.
 *
 * Privacy section 6 and Terms sections 3 and 5 all publish the 30-day window,
 * and a policy that promises deletion while nothing deletes anything is a false
 * statement. `RETENTION.accountDays` is the single value both this job and the
 * published pages read.
 *
 * This is the only destructive scheduled job in the system, so it is built to
 * refuse rather than to guess. See the three guards below.
 */

/**
 * More than this many companies selected in one run means the query is wrong,
 * not that fifty businesses cancelled overnight. The run aborts and deletes
 * nothing.
 */
const MAX_PER_RUN = 50;

export async function GET(request: Request): Promise<Response> {
  if (!cronAuthorized(request)) return cronUnauthorized();

  // The kill switch. Unset, the job reports exactly what it would delete and
  // touches nothing — which is how it should run in production until the
  // reported numbers have been watched for a while. The first run of a
  // deletion job against real customer data should never be its first run.
  const enabled = process.env.PURGE_ENABLED === "yes";

  const cutoff = new Date(
    Date.now() - RETENTION.accountDays * 24 * 60 * 60 * 1000,
  );

  const doomed = await prisma.org.findMany({
    where: {
      lapsedAt: { not: null, lt: cutoff },
      // Redundant with lapsedAt being set, and that is the point: an
      // independent second reason to refuse. A bug that leaves lapsedAt on a
      // paying company must not be enough on its own to delete them.
      subscriptionStatus: { notIn: [...ACTIVE_SUBSCRIPTION_STATUSES] },
    },
    select: { id: true, name: true, lapsedAt: true },
  });

  if (doomed.length > MAX_PER_RUN) {
    console.error(
      `Purge selected ${doomed.length} orgs, above the cap of ${MAX_PER_RUN}. ` +
        "Refusing to delete anything — this is far more likely to be a bad " +
        "query than a real wave of cancellations.",
    );
    return Response.json(
      { aborted: "cap-exceeded", selected: doomed.length, deleted: 0 },
      { status: 200 },
    );
  }

  let deleted = 0;
  for (const org of doomed) {
    if (!enabled) continue;
    if (await purgeOrg(org.id, cutoff)) deleted++;
  }

  // Consent records are removed here too, but only by their own expiresAt —
  // never as part of deleting an org. They have no foreign key to Org
  // precisely so this job cannot reach them that way: account data goes at 30
  // days, consent proof is kept three years, and both are published promises.
  const expiredConsent = enabled
    ? (await prisma.consentRecord.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      })).count
    : await prisma.consentRecord.count({
        where: { expiresAt: { lt: new Date() } },
      });

  return Response.json({
    enabled,
    selected: doomed.length,
    deleted,
    expiredConsentRecords: expiredConsent,
  });
}

/**
 * Deletes one company, children before parents.
 *
 * The org is re-read and re-checked inside the transaction. The selection
 * above and this deletion are separated by however long the loop takes, and a
 * company that resubscribes in that gap must not lose its data because a query
 * a moment earlier said it was doomed.
 */
async function purgeOrg(orgId: string, cutoff: Date): Promise<boolean> {
  try {
    return await prisma.$transaction(async (tx) => {
      const org = await tx.org.findUnique({
        where: { id: orgId },
        select: { lapsedAt: true, subscriptionStatus: true },
      });

      if (!org) return false;
      if (
        !org.lapsedAt ||
        org.lapsedAt >= cutoff ||
        (ACTIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(
          org.subscriptionStatus ?? "",
        )
      ) {
        console.error("Purge skipped an org that no longer qualifies", orgId);
        return false;
      }

      // Foreign keys are enforced, so order matters.
      await tx.session.deleteMany({ where: { user: { orgId } } });
      await tx.token.deleteMany({ where: { user: { orgId } } });
      await tx.job.deleteMany({ where: { orgId } });
      await tx.user.deleteMany({ where: { orgId } });
      await tx.customer.deleteMany({ where: { orgId } });
      await tx.crew.deleteMany({ where: { orgId } });
      await tx.pendingSignup.deleteMany({ where: { orgId } });
      await tx.org.delete({ where: { id: orgId } });

      console.log("Purged org after retention window", orgId);
      return true;
    });
  } catch (err) {
    // One company failing to delete must not abandon the rest of the run, and
    // must not report success either. The next run picks it up again.
    console.error(
      "Purge failed for org",
      orgId,
      err instanceof Error ? err.message : String(err),
    );
    return false;
  }
}
