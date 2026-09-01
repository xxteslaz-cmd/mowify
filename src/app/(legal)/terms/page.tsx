import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL, RETENTION } from "@/lib/legal";
import { PRICE, TRIAL_DAYS, formatPrice, pricePerInterval } from "@/lib/pricing";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The agreement between GroundsRoute and the companies that use it.",
};

const H2 = "mt-10 text-lg font-semibold text-foreground";
const P = "mt-3 text-sm leading-relaxed text-muted";
const UL = "mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted";
const STRONG = "font-medium text-foreground";

/**
 * Every figure here that the software also implements is read from the same
 * constant the software reads — the price and trial length from
 * src/lib/pricing.ts, the retention windows from src/lib/legal.ts. A published
 * term that says 30 days while the purge job uses 45 is not a discrepancy, it
 * is a false statement to a customer, and one number is the only reliable way
 * to prevent it.
 */
export default function TermsPage() {
  return (
    <article>
      <h1 className="text-2xl font-semibold text-foreground">
        Terms of Service
      </h1>
      <p className={P}>
        These Terms of Service (the &ldquo;Terms&rdquo;) are a contract between{" "}
        {LEGAL.entityLong} (&ldquo;GroundsRoute&rdquo;, &ldquo;we&rdquo;,
        &ldquo;us&rdquo;), and the business that creates an account for the
        GroundsRoute service (&ldquo;you&rdquo; or &ldquo;Customer&rdquo;). By
        creating an account, clicking to accept, or using the Service, you agree
        to these Terms. If you are accepting on behalf of a company, you
        represent that you have authority to bind it.
      </p>

      <h2 className={H2}>1. The Service</h2>
      <p className={P}>
        GroundsRoute is a web application for scheduling landscaping crews:
        booking jobs onto a calendar, generating recurring visits, and giving
        each crew a mobile view of its stops for the day. &ldquo;Service&rdquo;
        means that application, the website at groundsroute.com, and any related
        documentation and support we provide.
      </p>
      <p className={P}>
        The Service is a scheduling and record-keeping tool. It is not an
        accounting system, a payroll system, a system of record for employment
        or safety compliance, or a substitute for your own judgment about how to
        run your business.
      </p>

      <h2 className={H2}>2. Accounts and access</h2>
      <p className={P}>
        <span className={STRONG}>Owner accounts.</span> You create an owner
        account with an email address and password. You are responsible for
        keeping those credentials confidential and for all activity under your
        account.
      </p>
      <p className={P}>
        <span className={STRONG}>Crew accounts.</span> You create logins for
        your crew members consisting of a username and a six-digit PIN. You
        decide who gets an account, you set and reset PINs, and you are
        responsible for removing access when someone leaves. You acknowledge
        that a six-digit PIN is a convenience credential appropriate for
        low-sensitivity field access, not a high-security one, and that anyone
        holding a valid username and PIN for your company can see that
        crew&apos;s assigned stops. Do not put information in job notes that you
        would not want a crew member to read.
      </p>
      <p className={P}>
        <span className={STRONG}>Accuracy.</span> You agree to provide accurate
        account information and to keep it current, including a working email
        address, since we use it for password resets and billing notices.
      </p>

      <h2 className={H2}>3. Free trial</h2>
      <p className={P}>
        New companies may start a <span className={STRONG}>{TRIAL_DAYS}-day
        free trial</span>. The trial terms are these, and by starting a trial
        you confirm you have read and agree to them:
      </p>
      <ul className={UL}>
        <li>
          The trial lasts <span className={STRONG}>{TRIAL_DAYS} days</span> from
          the day you create your account. It is free — we will not charge you
          during it.
        </li>
        <li>
          <span className={STRONG}>
            A valid payment card is required to start the trial.
          </span>{" "}
          We collect it at signup and store it with Stripe.
        </li>
        <li>
          <span className={STRONG}>
            Unless you cancel before the trial ends, your subscription begins
            automatically on day {TRIAL_DAYS + 1} and your card is charged{" "}
            {pricePerInterval()}, and again each {PRICE.interval} after that,
            until you cancel.
          </span>{" "}
          Nothing further is required of you for that charge to happen.
        </li>
        <li>
          We will email you a reminder at least{" "}
          <span className={STRONG}>7 days before the trial ends</span>, telling
          you the date the charge will occur, the amount, and how to cancel.
        </li>
        <li>
          <span className={STRONG}>
            You may cancel at any time during the trial, from your billing page,
            in no more than a few clicks and without contacting us.
          </span>{" "}
          Cancel before the end of day {TRIAL_DAYS} and you are never charged.
        </li>
        <li>
          One trial per company. Trials are not available to companies that have
          previously trialed or subscribed to the Service, and cannot be
          combined or extended by creating additional accounts.
        </li>
        <li>
          We may withdraw or shorten a trial for suspected abuse of this section.
        </li>
      </ul>
      <p className={P}>
        <span className={STRONG}>
          If the trial ends without a successful payment,
        </span>{" "}
        your account becomes read-only: you and your crews can still sign in and
        see your schedule, and crews can still mark stops complete, but new
        records cannot be created until a subscription starts. We keep your data
        for <span className={STRONG}>{RETENTION.accountDays} days</span> after
        the trial ends so you can subscribe and pick up where you left off, then
        delete it. You may export your data at any time during that window from
        your settings page.
      </p>

      <h2 className={H2}>4. Subscription, billing, and cancellation</h2>
      <p className={P}>
        <span className={STRONG}>Fees.</span> After any trial, access to the
        Service requires a paid subscription at the rates shown at{" "}
        <Link href="/pricing" className="underline underline-offset-4">
          groundsroute.com/pricing
        </Link>
        . Fees are stated in U.S. dollars and are exclusive of taxes, which we
        will add where required.
      </p>
      <p className={P}>
        <span className={STRONG}>Payment.</span> Subscriptions are billed in
        advance through Stripe, our payment processor, using the card you
        provide. By starting a trial or subscribing, you authorise us to charge
        that card for the subscription and any applicable taxes on the schedule
        described in these Terms.
      </p>
      <p className={P}>
        <span className={STRONG}>Automatic renewal.</span> Your subscription
        renews automatically at the end of each {PRICE.interval} at the
        then-current rate, and your card is charged automatically,{" "}
        <span className={STRONG}>until you cancel</span>. You may cancel at any
        time from your billing page, without contacting us, or by emailing{" "}
        {LEGAL.contactEmail}. Because you signed up online, you can cancel
        online. Cancellation takes effect at the end of the current billing
        period; you keep access until then.
      </p>
      <p className={P}>
        <span className={STRONG}>Refunds.</span>{" "}
        <span className={STRONG}>
          If your free trial converts and you did not mean to subscribe, email{" "}
          {LEGAL.contactEmail} within 30 days of that first charge and we will
          refund it in full, without asking why.
        </span>{" "}
        Beyond that first charge, fees are non-refundable except where required
        by law, and we do not provide refunds or credits for partial periods,
        unused time, or periods during which you did not use the Service.
      </p>
      <p className={P}>
        <span className={STRONG}>Price changes.</span> We may change our prices.
        Changes apply from your next renewal, and we will give you at least 30
        days&apos; notice by email. If you do not accept a price change, cancel
        before it takes effect.
      </p>
      <p className={P}>
        <span className={STRONG}>Non-payment.</span> If a charge fails we may
        retry it and will notify you. If payment remains outstanding after 14
        days, we may suspend access until it is resolved, and may terminate the
        account and delete its data after a further {RETENTION.accountDays}{" "}
        days.
      </p>

      <h2 className={H2}>5. Your data</h2>
      <p className={P}>
        <span className={STRONG}>You own it.</span> As between you and us, you
        own all data you or your crews enter into the Service — customer
        records, addresses, jobs, schedules, notes, and completion history
        (&ldquo;Customer Data&rdquo;). We claim no ownership in it.
      </p>
      <p className={P}>
        <span className={STRONG}>Our licence.</span> You grant us a limited,
        non-exclusive licence to host, store, transmit, back up, and display
        Customer Data solely to provide the Service to you, to support you when
        you ask, and as otherwise permitted by our{" "}
        <Link href="/privacy" className="underline underline-offset-4">
          Privacy Policy
        </Link>
        . We do not use Customer Data for any other purpose, and we do not use
        it to train machine learning models.
      </p>
      <p className={P}>
        <span className={STRONG}>Your responsibilities.</span> Customer Data
        typically includes personal information about people who are not parties
        to these Terms — the names, addresses, and phone numbers of the
        properties you service. You represent that you have the right to collect
        that information and to enter it into the Service, and that doing so
        does not violate any law or any agreement you have with those
        individuals. As between us, you are the controller of that information
        and we process it on your behalf under the terms of our Privacy Policy,
        which is incorporated into these Terms.
      </p>
      <p className={P}>
        <span className={STRONG}>Export and deletion.</span> You may export your
        Customer Data at any time from your settings page, whether or not your
        subscription is active. After termination we retain it for{" "}
        {RETENTION.accountDays} days so you can retrieve it, then delete it. We
        will delete it sooner on written request.
      </p>

      <h2 className={H2}>6. Acceptable use</h2>
      <p className={P}>You agree not to use the Service to:</p>
      <ul className={UL}>
        <li>store or transmit unlawful, infringing, or harassing content;</li>
        <li>
          attempt to access another company&apos;s data or any part of the
          system you are not authorised to reach;
        </li>
        <li>
          probe, scan, or test the vulnerability of the Service without our
          prior written permission;
        </li>
        <li>
          interfere with or place undue load on the Service, including through
          automated scraping or excessive API-style requests;
        </li>
        <li>
          resell or provide the Service to third parties as a service bureau; or
        </li>
        <li>
          reverse engineer, decompile, or copy the Service except to the extent
          that restriction is unenforceable under applicable law.
        </li>
      </ul>
      <p className={P}>
        We may suspend access without notice if we reasonably believe your use
        threatens the security, integrity, or availability of the Service or
        another customer&apos;s data.
      </p>

      <h2 className={H2}>7. Availability, support, and changes</h2>
      <p className={P}>
        We aim to keep the Service available continuously but do not guarantee
        any level of uptime. The Service may be unavailable during maintenance,
        during failures of our infrastructure providers, or for reasons outside
        our control. We are not offering a service level agreement or uptime
        credits under these Terms.
      </p>
      <p className={P}>
        Support is provided by email at {LEGAL.contactEmail} during ordinary
        business hours. We may add, change, or remove features over time. If we
        materially reduce core functionality you rely on, we will give you at
        least 30 days&apos; notice by email, and you may cancel and receive a
        pro-rated refund of any prepaid fees covering the period after the
        change.
      </p>

      <h2 className={H2}>8. Scheduling disclaimer</h2>
      <p className={P}>
        You are responsible for the accuracy of your own schedule. Features that
        generate visits for recurring jobs are conveniences that operate on the
        parameters you supply; they do not relieve you of the obligation to
        review your schedule and confirm that work is assigned and completed.{" "}
        <span className={STRONG}>
          We are not responsible for missed, duplicated, late, or incorrectly
          assigned visits, or for any resulting loss of a customer, contract, or
          revenue
        </span>
        , whether the cause is your configuration, a defect in the Service, or
        unavailability of the Service. Keep your own records for any job whose
        loss you could not absorb.
      </p>

      <h2 className={H2}>9. Intellectual property</h2>
      <p className={P}>
        We own the Service, including its software, design, and content, and all
        intellectual property rights in it. These Terms grant you a limited,
        non-exclusive, non-transferable, revocable right to use the Service
        during your subscription, and nothing more. &ldquo;GroundsRoute&rdquo;
        and our logos are our trademarks; you may not use them without
        permission.
      </p>
      <p className={P}>
        If you send us feedback, suggestions, or feature requests, we may use
        them without restriction or obligation to you.
      </p>

      <h2 className={H2}>10. Confidentiality</h2>
      <p className={P}>
        Each party may receive non-public information from the other. The
        receiving party will protect it with at least reasonable care, use it
        only to perform under these Terms, and not disclose it except to
        personnel and advisors who need it and are bound by similar obligations.
        This does not apply to information that is public through no fault of
        the receiving party, was already known to it, is independently
        developed, or must be disclosed by law — in which case the receiving
        party will give notice where legally permitted.
      </p>

      <h2 className={H2}>11. Term and termination</h2>
      <p className={P}>
        These Terms begin when you create an account and continue until
        terminated. You may terminate at any time by cancelling your
        subscription. We may terminate or suspend your account if you materially
        breach these Terms and do not cure the breach within 15 days of written
        notice, immediately if you breach Section 6 in a way that threatens the
        Service or another customer, or if you fail to pay as described in
        Section 4. We may also discontinue the Service entirely on 60 days&apos;
        notice, refunding any prepaid fees for the period after discontinuation.
      </p>
      <p className={P}>
        On termination your right to use the Service ends immediately. Sections
        5 (as to ownership), 8, 9, 10, 12, 13, 14, and 15 survive.
      </p>

      <h2 className={H2}>12. Disclaimer of warranties</h2>
      <p className={P}>
        <span className={STRONG}>
          THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS
          AVAILABLE.&rdquo; TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE DISCLAIM
          ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING IMPLIED WARRANTIES OF
          MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND
          NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE
          UNINTERRUPTED, ERROR-FREE, OR SECURE, OR THAT ANY DATA WILL BE
          PRESERVED WITHOUT LOSS.
        </span>{" "}
        Some jurisdictions do not allow the exclusion of implied warranties, so
        parts of this section may not apply to you.
      </p>

      <h2 className={H2}>13. Limitation of liability</h2>
      <p className={P}>
        <span className={STRONG}>
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, NEITHER PARTY WILL BE LIABLE
          FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE
          DAMAGES, OR FOR ANY LOST PROFITS, LOST REVENUE, LOST BUSINESS, OR LOST
          OR CORRUPTED DATA, EVEN IF ADVISED OF THE POSSIBILITY.
        </span>
      </p>
      <p className={P}>
        <span className={STRONG}>
          OUR TOTAL LIABILITY ARISING OUT OF OR RELATING TO THESE TERMS OR THE
          SERVICE WILL NOT EXCEED THE AMOUNT YOU PAID US IN THE TWELVE MONTHS
          BEFORE THE EVENT GIVING RISE TO THE CLAIM.
        </span>
      </p>
      <p className={P}>
        These limits do not apply to your payment obligations, to either
        party&apos;s indemnification obligations, or to liability that cannot be
        limited by law.
      </p>

      <h2 className={H2}>14. Indemnification</h2>
      <p className={P}>
        You will defend and indemnify us against third-party claims arising from
        your Customer Data, including claims that your collection or use of
        information about your customers violated their rights or any law; from
        your use of the Service in breach of these Terms or in violation of law;
        and from your employment or engagement of the individuals to whom you
        give crew accounts. We will notify you of any such claim, give you
        control of the defence, and cooperate reasonably at your expense.
      </p>

      <h2 className={H2}>15. Governing law and disputes</h2>
      <p className={P}>
        These Terms are governed by the laws of {LEGAL.jurisdiction}, without
        regard to conflict of laws rules. The parties agree to the exclusive
        jurisdiction of the state and federal courts located in {LEGAL.county},
        Pennsylvania, and each waives any objection to venue there.
      </p>
      <p className={P}>
        Before filing anything, the parties will attempt in good faith to
        resolve the dispute by discussing it for at least 30 days after written
        notice describing the claim.
      </p>
      <p className={P}>
        <span className={STRONG}>
          Each party waives any right to a jury trial, and neither party may
          bring claims as a class representative or class member.
        </span>
      </p>

      <h2 className={H2}>16. General</h2>
      <p className={P}>
        These Terms, together with the Privacy Policy, are the entire agreement
        between us on this subject and supersede any prior discussions. Any
        purchase order or vendor terms you send us have no effect.
      </p>
      <p className={P}>
        We may modify these Terms; if a change is material we will give at least
        30 days&apos; notice by email or in the Service, and continued use after
        it takes effect is acceptance. If you do not agree, cancel before then.
      </p>
      <p className={P}>
        You may not assign these Terms without our written consent; we may
        assign them in connection with a merger, acquisition, or sale of assets.
        Neither party is liable for delays caused by events beyond its
        reasonable control. If any provision is unenforceable, it is modified to
        the minimum extent necessary and the rest remains in force. A failure to
        enforce a provision is not a waiver of it. Notices to you go to the
        email on your account; notices to us go to {LEGAL.contactEmail}. There
        are no third-party beneficiaries.
      </p>

      <h2 className={H2}>17. Contact</h2>
      <p className={P}>
        {LEGAL.entityLong}
        <br />
        {LEGAL.mailingAddress}
        <br />
        {LEGAL.contactEmail}
      </p>
      <p className={P}>
        Prices referenced in these Terms are {formatPrice()} per{" "}
        {PRICE.interval}, as published on our{" "}
        <Link href="/pricing" className="underline underline-offset-4">
          pricing page
        </Link>
        .
      </p>
    </article>
  );
}
