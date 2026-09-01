import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL, RETENTION, SUBPROCESSORS } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "What GroundsRoute collects, why, who else sees it, and how long it is kept.",
};

const H2 = "mt-10 text-lg font-semibold text-foreground";
const P = "mt-3 text-sm leading-relaxed text-muted";
const UL = "mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted";
const STRONG = "font-medium text-foreground";

export default function PrivacyPage() {
  return (
    <article>
      <h1 className="text-2xl font-semibold text-foreground">Privacy Policy</h1>

      <h2 className={H2}>In short</h2>
      <p className={P}>
        GroundsRoute is crew scheduling software for landscaping companies. We
        collect the minimum needed to run it: your account details, the job and
        customer records you enter, and basic technical logs. We do not sell
        personal information, we do not run advertising, and we do not use the
        records you enter about your own customers for anything other than
        providing the service to you.
      </p>

      <h2 className={H2}>1. Who this policy covers</h2>
      <p className={P}>
        This policy explains how {LEGAL.entityLong} (&ldquo;GroundsRoute&rdquo;,
        &ldquo;we&rdquo;, &ldquo;us&rdquo;) handles personal information in
        connection with the website at groundsroute.com and the GroundsRoute
        application (together, the &ldquo;Service&rdquo;).
      </p>
      <p className={P}>
        It applies to two groups of people, and the distinction between them
        matters.
      </p>
      <p className={P}>
        <span className={STRONG}>Subscribers</span> are the landscaping
        companies that sign up for GroundsRoute, together with the owners and
        crew members who log in. For information about these people we act as
        the business that decides how the information is used — a
        &ldquo;controller&rdquo; under most privacy laws.
      </p>
      <p className={P}>
        <span className={STRONG}>Your customers</span> are the property owners
        and clients whose names, addresses, and job details a Subscriber enters
        into GroundsRoute. We hold this information on the Subscriber&apos;s
        behalf and act only on their instructions — a &ldquo;processor&rdquo; or
        &ldquo;service provider&rdquo;. We do not decide what is done with it,
        we do not use it for our own purposes, and we have no direct
        relationship with these individuals.
      </p>
      <p className={P}>
        If you are a customer of a landscaping company that uses GroundsRoute
        and you want to know what that company holds about you, or want it
        corrected or deleted, contact that company directly. If you contact us
        instead, we will refer your request to them.
      </p>

      <h2 className={H2}>2. Information we collect</h2>
      <p className={P}>
        <span className={STRONG}>Account information.</span> When a company
        signs up we collect the company name, the owner&apos;s name and email
        address, and a password. We never store passwords themselves — only an
        argon2 hash, from which the original password cannot practically be
        recovered.
      </p>
      <p className={P}>
        <span className={STRONG}>Crew accounts.</span> Owners create logins for
        their crew members consisting of a username, a display name, and a
        six-digit PIN. Crew members do not give us an email address and have no
        direct account relationship with us; their employer creates, manages,
        and removes their access. PINs are stored hashed, never in plain text.
      </p>
      <p className={P}>
        <span className={STRONG}>Job and customer records.</span> Subscribers
        enter information about their own customers and work: customer names,
        service addresses, contact details, job descriptions and notes,
        schedules, recurring service patterns, crew assignments, and completion
        status and timestamps. What goes into these records is entirely the
        Subscriber&apos;s choice.
      </p>
      <p className={P}>
        <span className={STRONG}>Billing information.</span> A payment card is
        required at signup, including to start a free trial. Payments are
        processed by Stripe. Card numbers, expiration dates, and security codes
        are transmitted directly to Stripe and are never stored on our systems.
        We receive and retain a Stripe customer identifier, the plan, trial and
        subscription status, and billing history. We also retain a record of
        your agreement to the subscription and trial terms, including the date
        and the version of the terms you accepted, for at least{" "}
        {RETENTION.consentYears} years as required by automatic renewal laws.
      </p>
      <p className={P}>
        <span className={STRONG}>Technical and log information.</span> Our
        servers and infrastructure providers record IP addresses, browser and
        device type, requested pages, timestamps, and error diagnostics. We keep
        a database record for each active login session containing a hashed
        session token, creation and expiration times, and the associated
        account.
      </p>
      <p className={P}>
        <span className={STRONG}>Email delivery information.</span> Transactional
        email — password resets, email verification, address changes, and
        billing notices such as the reminder before a trial ends — is sent
        through Resend, which processes the recipient address and delivery
        status. We do not send marketing email unless you separately opt in.
      </p>
      <p className={P}>
        <span className={STRONG}>What we do not collect.</span> GroundsRoute
        does not track the physical location of crew members or vehicles. It
        does not access GPS, contacts, camera, or microphone. We do not use
        advertising cookies or tracking pixels in our email, and our email
        templates contain no externally hosted images or scripts.
      </p>

      <h2 className={H2}>3. How we use information</h2>
      <p className={P}>
        We use the information above to create and authenticate accounts and
        maintain login sessions; to display schedules to owners and the correct
        daily stop list to each crew; to generate future visits for recurring
        jobs; to process subscription payments and send billing notices; to send
        transactional email such as password resets; to respond to support
        requests; to monitor for abuse, investigate security incidents, and
        debug problems; and to comply with legal obligations.
      </p>
      <p className={P}>
        We may also produce aggregated, de-identified statistics about how the
        Service is used — for example, how many companies use recurring
        scheduling — provided those statistics contain no personal information
        and cannot reasonably be re-associated with any individual or company.
      </p>
      <p className={P}>
        We do not use Customer Data to train machine learning models, and we do
        not use it for any purpose other than providing the Service to the
        Subscriber who entered it.
      </p>

      <h2 className={H2}>4. How we share information</h2>
      <p className={P}>
        We share information only with service providers that help us operate
        the Service, each bound by contract to protect it and use it only for
        that purpose:
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="py-2 pr-4 font-medium text-foreground">Provider</th>
              <th className="py-2 pr-4 font-medium text-foreground">Purpose</th>
              <th className="py-2 font-medium text-foreground">Location</th>
            </tr>
          </thead>
          <tbody>
            {SUBPROCESSORS.map((p) => (
              <tr key={p.name} className="border-b border-border align-top">
                <td className="py-2 pr-4 text-foreground">{p.name}</td>
                <td className="py-2 pr-4 leading-relaxed text-muted">
                  {p.purpose}
                </td>
                <td className="py-2 whitespace-nowrap text-muted">
                  United States
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={P}>
        We may also disclose information to professional advisors such as
        lawyers and accountants under confidentiality obligations; to law
        enforcement or other parties when required by law, subpoena, or court
        order, or where necessary to protect our rights or someone&apos;s
        safety; and to a successor entity in connection with a merger,
        acquisition, or sale of assets, with notice to affected Subscribers.
      </p>
      <p className={P}>
        <span className={STRONG}>We do not sell personal information</span>, and
        have not done so in the preceding twelve months. We do not share
        personal information for cross-context behavioural advertising, and we
        do not disclose sensitive personal information for any purpose beyond
        those listed above.
      </p>

      <h2 className={H2}>5. Tenant separation and security</h2>
      <p className={P}>
        Because many independent companies share the Service, keeping their data
        separate is the central design constraint. Every database read and write
        in the owner-facing application is scoped to the requesting
        company&apos;s records at the data-access layer itself, rather than
        relying on individual pages or features to apply the restriction
        correctly. This separation is verified by an automated test suite that
        creates two companies and asserts that neither can reach the
        other&apos;s records.
      </p>
      <p className={P}>We also use:</p>
      <ul className={UL}>
        <li>TLS for data in transit;</li>
        <li>argon2 hashing for passwords and crew PINs;</li>
        <li>
          session cookies that carry only a random token whose SHA-256 hash is
          stored server-side, so that disclosure of the database alone does not
          yield usable sessions;
        </li>
        <li>account lockout after repeated failed login attempts;</li>
        <li>
          constant-cost login handling, so response timing does not reveal which
          email addresses or usernames are registered.
        </li>
      </ul>
      <p className={P}>
        No system is perfectly secure and we do not represent that ours is. If
        we become aware of a security breach affecting your information, we will
        notify you without undue delay and as required by applicable law.
      </p>

      <h2 className={H2}>6. How long we keep information</h2>
      <p className={P}>
        Account and Customer Data are retained for as long as the trial or
        subscription is active. After a trial ends without payment, or after
        cancellation or termination, we retain the data for{" "}
        <span className={STRONG}>{RETENTION.accountDays} days</span> so that it
        can be restored or exported, then delete it. We will delete data sooner
        on written request, subject to any legal obligation to retain it. You
        can export your data at any point during that window from your settings
        page.
      </p>
      <p className={P}>
        Records evidencing your consent to subscription and trial terms are
        retained for at least {RETENTION.consentYears} years, as automatic
        renewal laws require. These are kept separately from your account, so
        they survive the deletion described above and are removed on their own
        schedule.
      </p>
      <p className={P}>
        Session records expire automatically and are purged after expiration.
        Server logs are retained for approximately {RETENTION.logDays} days.
        Billing and tax records are retained for {RETENTION.billingYears} years
        as required by law. Encrypted backups follow a rolling{" "}
        {RETENTION.accountDays}-day cycle and are overwritten in the ordinary
        course; data deleted from the live database may persist in backups until
        that cycle completes.
      </p>

      <h2 className={H2}>7. Your privacy rights</h2>
      <p className={P}>
        Depending on where you live, you may have the right to know what
        personal information we hold about you, to obtain a copy of it, to
        correct inaccuracies, to request deletion, to obtain a portable copy,
        and to opt out of sale or targeted advertising — the last of which does
        not apply, because we do neither. We will not discriminate against you
        for exercising any of these rights.
      </p>
      <p className={P}>
        To make a request, email {LEGAL.contactEmail} from the address
        associated with your account, or include enough detail for us to locate
        your records. We will verify your identity before acting, and we will
        respond within the time required by applicable law, generally 45 days.
        An authorised agent may submit a request on your behalf with written
        proof of authorisation.
      </p>
      <p className={P}>
        If we decline your request, you may appeal by replying to our response
        with the word &ldquo;appeal&rdquo;. We will inform you of our decision
        on appeal in writing within 45 days, along with the reasons. If your
        appeal is denied, you may contact your state attorney general.
      </p>
      <p className={P}>
        Requests about records that a landscaping company entered into
        GroundsRoute about its own customers must be directed to that company,
        which controls those records. We will assist them in responding.
      </p>

      <h2 className={H2}>8. Children</h2>
      <p className={P}>
        The Service is intended for use by businesses and is not directed to
        children. We do not knowingly collect personal information from anyone
        under 13, and Subscribers must not create crew accounts for anyone under
        13. Where a Subscriber creates a crew account for a minor of working
        age, the Subscriber is responsible for complying with applicable child
        labour and privacy laws, including obtaining any required parental
        consent. If we learn that we have collected information from a child
        under 13, we will delete it.
      </p>

      <h2 className={H2}>9. Location of the Service</h2>
      <p className={P}>
        GroundsRoute is offered to businesses in the United States and its
        infrastructure is located in the United States. It is not intended for
        use by residents of the European Economic Area, the United Kingdom, or
        Switzerland, and we make no representation that it complies with the
        requirements of those jurisdictions.
      </p>

      <h2 className={H2}>10. Changes to this policy</h2>
      <p className={P}>
        We may update this policy from time to time. If we make a material
        change we will notify Subscribers by email or through the Service at
        least 30 days before it takes effect, and update the date at the bottom
        of this page. Continued use after the change takes effect constitutes
        acceptance.
      </p>

      <h2 className={H2}>11. Contact</h2>
      <p className={P}>
        {LEGAL.entityLong}
        <br />
        {LEGAL.mailingAddress}
        <br />
        {LEGAL.contactEmail}
      </p>
      <p className={P}>
        Our{" "}
        <Link href="/terms" className="underline underline-offset-4">
          Terms of Service
        </Link>{" "}
        govern your use of the Service and incorporate this policy.
      </p>
    </article>
  );
}
