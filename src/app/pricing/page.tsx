import type { Metadata } from "next";
import Link from "next/link";
import { PRICE, TRIAL_DAYS, formatPrice, pricePerInterval } from "@/lib/pricing";
import { trialDisclosure } from "@/lib/consent";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "One plan, one price. GroundsRoute is $49 per month with a 30-day free trial.",
};

// Terms section 4 points customers here for the rates, so this page existing is
// a precondition of publishing that document — a contract that cites a 404 is
// worse than one that cites nothing.
const INCLUDED = [
  "Unlimited customers, jobs and crews",
  "A phone view for each crew, showing only that day's stops",
  "Recurring jobs that regenerate on their own",
  "Logins for your crew that you create and revoke yourself",
  "Every feature — there is no higher tier to upgrade to",
];

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <Link
        href="/"
        className="text-sm text-muted underline underline-offset-4 hover:text-foreground"
      >
        ← GroundsRoute
      </Link>

      <h1 className="mt-8 text-2xl font-semibold">Pricing</h1>
      <p className="mt-2 text-sm text-muted">
        One plan. No setup fee, no per-crew pricing, no annual commitment.
      </p>

      <div className="card mt-8 p-6">
        <p className="text-3xl font-semibold">
          {formatPrice()}
          <span className="text-base font-normal text-muted">
            {" "}
            per {PRICE.interval}
          </span>
        </p>
        <p className="mt-2 text-sm text-muted">
          {TRIAL_DAYS} days free to start. A card is required to begin the
          trial, and you can cancel any time from your billing page.
        </p>

        <ul className="mt-6 space-y-2 text-sm">
          {INCLUDED.map((item) => (
            <li key={item} className="flex items-start gap-2">
              <span aria-hidden className="mt-0.5 text-brand">
                ✓
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ul>

        <Link href="/signup" className="btn btn-primary mt-6 w-full">
          Start your free trial
        </Link>
      </div>

      {/* The same words the signup page shows above the card and that the
          consent record stores. Anyone comparing the two pages should find
          them identical, because they are one function. */}
      <div className="card mt-6 p-6">
        <h2 className="text-sm font-semibold">How the trial and billing work</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {trialDisclosure()}
        </p>
        <p className="mt-4 text-sm text-muted">
          The full terms are in our{" "}
          <Link href="/terms" className="underline underline-offset-4">
            Terms of Service
          </Link>
          .
        </p>
      </div>

      <p className="mt-8 text-sm text-muted">
        Prices are in {PRICE.currency} and exclude any tax we are required to
        add. If we ever change the price, we will email you at least 30 days
        before it affects you, and {pricePerInterval()} stays your rate until
        then.
      </p>
    </div>
  );
}
