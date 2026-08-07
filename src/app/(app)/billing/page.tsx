import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth/dal";
import { isOrgActive } from "@/lib/subscription";
import BillingClient from "./BillingClient";

const LABELS: Record<string, string> = {
  trialing: "Free trial",
  active: "Active",
  past_due: "Payment failed",
  canceled: "Cancelled",
  unpaid: "Unpaid",
  incomplete: "Incomplete",
};

function formatDate(value: Date | null): string {
  if (!value) return "—";
  return value.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default async function BillingPage() {
  const { orgId } = await requireOwner();

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

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="text-xl font-semibold">Billing</h1>

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

        {org.stripeCustomerId ? (
          <div className="mt-6">
            <BillingClient />
          </div>
        ) : (
          <p className="mt-6 text-sm text-muted">
            No billing account is attached to this company yet.
          </p>
        )}
      </div>
    </div>
  );
}
