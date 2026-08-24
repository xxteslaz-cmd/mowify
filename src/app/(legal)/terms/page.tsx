import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The agreement between GroundsRoute and the companies that use it.",
};

const H2 = "mt-10 text-lg font-semibold text-foreground";
const P = "mt-3 text-sm leading-relaxed text-muted";
const UL = "mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted";

export default function TermsPage() {
  return (
    <article>
      <h1 className="text-2xl font-semibold text-foreground">
        Terms of Service
      </h1>
      <p className={P}>
        These terms govern your use of GroundsRoute, crew scheduling software
        operated by {LEGAL.entity} (&ldquo;we&rdquo;, &ldquo;us&rdquo;). By
        creating a company on GroundsRoute you agree to them. If you are
        agreeing on behalf of a business, you confirm you are authorised to bind
        that business.
      </p>

      <h2 className={H2}>1. What the service does</h2>
      <p className={P}>
        GroundsRoute lets you record customers and jobs, assign them to crews
        across a calendar, and give each crew a phone page listing their stops
        for the day. Recurring jobs regenerate automatically. We provide the
        software; we do not perform, supervise or guarantee any landscaping work
        scheduled through it.
      </p>

      <h2 className={H2}>2. Your account</h2>
      <ul className={UL}>
        <li>
          You are responsible for everything that happens under your company&apos;s
          account, including logins you create for your crew.
        </li>
        <li>
          Crew members sign in with a username and a 6-digit PIN that you set. A
          6-digit PIN is convenient for someone working from a phone in the
          field; it is not a strong secret. Choose PINs accordingly, change them
          when someone leaves, and do not reuse them for anything else.
        </li>
        <li>
          Keep your own password confidential and tell us promptly if you
          believe your account has been accessed by someone else.
        </li>
        <li>
          You must give accurate account information and keep your email address
          current, because that address is how you recover access.
        </li>
      </ul>

      <h2 className={H2}>3. Trial, subscription and payment</h2>
      <ul className={UL}>
        <li>
          New companies get a 30-day free trial. A payment card is required to
          start the trial.
        </li>
        <li>
          After the trial the subscription is $49 per month, billed
          automatically to the card on file until you cancel.
        </li>
        <li>
          Payments are processed by Stripe. Your card details are entered on
          Stripe&apos;s own pages and are never received or stored by our
          servers.
        </li>
        <li>
          You can cancel at any time from the billing page. Cancellation stops
          future charges and takes effect at the end of the period you have
          already paid for. We do not provide pro-rata refunds for a partial
          month unless the law requires it.
        </li>
        <li>
          If a payment fails or the subscription lapses, your account becomes
          read-only: you and your crew can still see the schedule and crews can
          still mark stops complete, but new records cannot be created until
          billing is restored.
        </li>
        <li>
          We may change the price. If we do, we will give you notice by email
          before the change applies to you, and you may cancel before it takes
          effect.
        </li>
      </ul>

      <h2 className={H2}>4. Your data and your customers&apos; data</h2>
      <p className={P}>
        The records you enter — your customers&apos; names, addresses, phone
        numbers and job notes — remain yours. We store and process them only to
        provide the service to you. You decide what to collect and you are
        responsible for having a lawful basis to hold it and for telling your
        own customers how their information is used. How we handle all of this
        is set out in our{" "}
        <Link href="/privacy" className="underline underline-offset-4">
          Privacy Policy
        </Link>
        .
      </p>

      <h2 className={H2}>5. Acceptable use</h2>
      <p className={P}>You agree not to:</p>
      <ul className={UL}>
        <li>
          attempt to access another company&apos;s data, probe the service&apos;s
          access controls, or interfere with its operation;
        </li>
        <li>
          upload unlawful content, or use the service to send anything you are
          not entitled to send;
        </li>
        <li>
          resell or white-label the service without our written agreement;
        </li>
        <li>
          place automated load on the service beyond ordinary use of the
          product.
        </li>
      </ul>

      <h2 className={H2}>6. Availability</h2>
      <p className={P}>
        We work to keep GroundsRoute available and to hold your data safely, but
        we do not promise uninterrupted or error-free service. The service is
        provided &ldquo;as is&rdquo;, without warranties of any kind to the
        fullest extent the law allows. Maintenance, third-party outages and
        faults will sometimes make it unavailable. Keep your own record of
        anything you cannot afford to lose.
      </p>

      <h2 className={H2}>7. Limitation of liability</h2>
      <p className={P}>
        To the fullest extent permitted by law, we are not liable for lost
        profits, lost business, or indirect or consequential loss arising from
        your use of the service — including work missed because the schedule was
        unavailable. Our total liability for any claim is limited to the amount
        you paid us in the twelve months before the claim arose. Nothing here
        excludes liability that cannot lawfully be excluded.
      </p>

      <h2 className={H2}>8. Suspension and termination</h2>
      <p className={P}>
        You may stop using the service and cancel at any time. We may suspend or
        close an account that breaches these terms, that is used unlawfully, or
        whose payments remain unresolved. If we close your account other than
        for breach, we will give you a reasonable opportunity to export your
        data first.
      </p>

      <h2 className={H2}>9. Changes to these terms</h2>
      <p className={P}>
        We may update these terms as the product changes. If a change materially
        affects your rights we will notify you by email or in the app before it
        takes effect. Continuing to use GroundsRoute after that means you accept
        the updated terms.
      </p>

      <h2 className={H2}>10. Governing law and contact</h2>
      <p className={P}>
        These terms are governed by the laws of {LEGAL.jurisdiction}. Questions
        about them can go to {LEGAL.contactEmail}.
      </p>
    </article>
  );
}
