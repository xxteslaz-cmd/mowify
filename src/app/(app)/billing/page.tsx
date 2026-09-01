import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth/dal";
import { isOrgActive } from "@/lib/subscription";
import { pricePerInterval } from "@/lib/pricing";
import BillingClient from "./BillingClient";

const LABELS: Record<string, string> = {
  trialing: "Free trial",
  active: "Active",
  past_due: "Payment failed",
  canceled: "Cancelled",
  unpaid: "Unpaid",
  incomplete: "Incomplete",
};

/**
 * Statuses where a subscription still exists and the Billing Portal can repair
 * it by taking a working card. Offering "restart" for these would create a
 * *second* subscription alongside one Stripe is still trying to collect on,
 * which is how a customer ends up billed twice.
 *
 * `incomplete` is deliberately in this list: the subscription is mid-payment,
 * and Stripe cancels it on its own after about a day if it never completes.
 */
const REPAIRABLE_IN_PORTAL = ["past_due", "unpaid", "incomplete"];

function formatDate(value: Date | null): string {
  if (!value) return "—";
  return value.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ restarted?: string }>;
}) {
  const { orgId } = await requireOwner();
  const { restarted } = await searchParams;

  const org = await prisma.org.findUniqueOrThrow({
    where: { id: orgId },
    select: {
      subscriptionStatus: true,
      trialEndsAt: true,
      currentPeriodEnd: true,
      stripeCustomerId: true,
    },
  });

  const active = isOrgActive(org.subscriptionStatus);
  const status = org.subscriptionStatus ?? "none";

  // Restart is for a company with nothing left to repair — cancelled, or one
  // that predates billing and has no subscription at all. The portal cannot
  // help either of them: per Stripe, a cancelled subscription does not appear
  // in the portal and a new one has to be created.
  const canRestart = !active && !REPAIRABLE_IN_PORTAL.includes(status);

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="text-xl font-semibold">Billing</h1>

      {/* Stripe has taken the payment, but the subscription reaches this row by
          webhook, which is usually a second or two behind the redirect. Saying
          "shortly" rather than showing a status avoids calling the account
          lapsed to someone who has just paid. */}
      {restarted ? (
        <p className="card mt-4 border-brand bg-brand-soft p-4 text-sm">
          Thanks — your payment went through. Your subscription will show as
          active here shortly.
        </p>
      ) : null}

      <div className="card mt-4 p-6">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-muted">Status</dt>
            <dd className="mt-1 font-medium">{LABELS[status] ?? "No subscription"}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">
              {org.subscriptionStatus === "trialing" ? "Trial ends" : "Next billing date"}
            </dt>
            <dd className="mt-1 font-medium">
              {formatDate(
                org.subscriptionStatus === "trialing"
                  ? org.trialEndsAt
                  : org.currentPeriodEnd,
              )}
            </dd>
          </div>
        </dl>

        {!active ? (
          <p className="mt-4 text-sm">
            Your account is read-only until billing is sorted out. Your schedule and
            customers are all still here, and your crews can still mark stops complete.
          </p>
        ) : null}

        {canRestart ? (
          <p className="mt-4 text-sm text-muted">
            Restarting costs {pricePerInterval()} and begins straight away. Your
            schedule, customers and crews are exactly as you left them.
          </p>
        ) : null}

        <div className="mt-6">
          <BillingClient
            canRestart={canRestart}
            canManage={Boolean(org.stripeCustomerId)}
          />
        </div>
      </div>
    </div>
  );
}
