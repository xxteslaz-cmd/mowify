import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL, SUBPROCESSORS } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "What GroundsRoute collects, why, who it is shared with, and how long it is kept.",
};

const H2 = "mt-10 text-lg font-semibold text-foreground";
const P = "mt-3 text-sm leading-relaxed text-muted";
const UL = "mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted";

export default function PrivacyPage() {
  return (
    <article>
      <h1 className="text-2xl font-semibold text-foreground">Privacy Policy</h1>
      <p className={P}>
        GroundsRoute is operated by {LEGAL.entity}. This policy explains what we
        collect, why we hold it, who else sees it and how long we keep it. It
        covers both the people who run a company on GroundsRoute and the
        customer records those companies enter.
      </p>

      <h2 className={H2}>What we collect</h2>
      <ul className={UL}>
        <li>
          <span className="font-medium text-foreground">Your account.</span> Your
          company name, your name, your email address and a hashed form of your
          password. We never store the password itself.
        </li>
        <li>
          <span className="font-medium text-foreground">Crew logins.</span> The
          name and username you give each crew member, and a hashed form of
          their PIN. Crew members have no email address in the system.
        </li>
        <li>
          <span className="font-medium text-foreground">
            The records you enter.
          </span>{" "}
          Your customers&apos; names, service addresses, phone numbers and any
          notes you add, along with the jobs scheduled against them.
        </li>
        <li>
          <span className="font-medium text-foreground">Billing.</span> Your
          subscription status and the identifiers Stripe gives us to recognise
          your account.
        </li>
        <li>
          <span className="font-medium text-foreground">Technical data.</span>{" "}
          The ordinary server and security logs a hosted application produces,
          such as request times and error records.
        </li>
      </ul>

      <h2 className={H2}>What we deliberately do not collect</h2>
      <ul className={UL}>
        <li>
          <span className="font-medium text-foreground">Card numbers.</span>{" "}
          Payment details are entered on Stripe&apos;s own hosted pages. They
          never reach our servers and we cannot see them.
        </li>
        <li>
          <span className="font-medium text-foreground">
            Advertising and analytics profiles.
          </span>{" "}
          There are no third-party analytics, advertising or tracking scripts in
          this application. We do not sell or share your data for advertising,
          and we do not build profiles of you or your customers.
        </li>
        <li>
          <span className="font-medium text-foreground">Location tracking.</span>{" "}
          The crew view shows the addresses you scheduled. It does not track
          where anyone actually is.
        </li>
      </ul>

      <h2 className={H2}>Why we hold it</h2>
      <p className={P}>
        To run the service you asked for: to sign you in, to show the right
        schedule to the right people, to keep one company&apos;s data separate
        from every other company&apos;s, to take payment, to send the few
        transactional emails the product needs, and to investigate faults and
        abuse.
      </p>

      <h2 className={H2}>Cookies</h2>
      <p className={P}>
        We set one essential cookie to keep you signed in, and a short-lived one
        during signup to reconnect you with your payment when you return from
        Stripe. Both are strictly necessary for the service to work. There are
        no advertising or analytics cookies, so there is nothing here to opt out
        of. The session cookie holds a random token; only a one-way hash of it
        is stored on our side, so the stored value cannot be used to sign in as
        you.
      </p>

      <h2 className={H2}>Who else sees it</h2>
      <p className={P}>
        We do not sell your data. We share it only with the providers needed to
        run the service:
      </p>
      <ul className={UL}>
        {SUBPROCESSORS.map(({ name, purpose }) => (
          <li key={name}>
            <span className="font-medium text-foreground">{name}.</span>{" "}
            {purpose}
          </li>
        ))}
      </ul>
      <p className={P}>
        We may also disclose data where the law requires it, or to protect our
        rights or the safety of others.
      </p>

      <h2 className={H2}>Your customers&apos; information</h2>
      <p className={P}>
        When your company enters a customer&apos;s name, address and phone
        number, that record is yours and you decide what goes in it. We process
        it on your instructions to provide the service. You are responsible for
        having a lawful basis to hold it and for telling your own customers how
        you use it. If one of your customers asks us directly to access or
        delete their information, we will point them to you and let you know.
      </p>

      <h2 className={H2}>How it is protected</h2>
      <ul className={UL}>
        <li>Passwords and crew PINs are stored using the argon2 hash function.</li>
        <li>
          Sessions live in the database, and only a SHA-256 hash of each session
          token is stored, so a copy of the database yields no usable sessions.
        </li>
        <li>
          Every read and write of your business data is scoped to your company
          at the point it reaches the database, and that separation is covered
          by automated tests.
        </li>
        <li>Traffic is served over HTTPS.</li>
      </ul>
      <p className={P}>
        No system is perfectly secure, and we cannot guarantee absolute
        security. If a breach affects your data we will tell you promptly and
        within any period the law requires.
      </p>

      <h2 className={H2}>How long we keep it</h2>
      <p className={P}>
        We keep your company&apos;s records for as long as the account is open.
        If you close it, we delete or anonymise the data within 90 days, except
        where we must keep something longer — billing and tax records, for
        instance. Expired sessions and used sign-in links are cleared as a
        matter of course.
      </p>

      <h2 className={H2}>Your rights</h2>
      <p className={P}>
        Depending on where you live, you may have the right to access a copy of
        your data, correct it, delete it, restrict or object to how we use it,
        or receive it in a portable form. You can change your name, email
        address and password from your account page at any time. For anything
        else, write to {LEGAL.contactEmail} and we will respond within the time
        the law allows. You may also complain to your local data protection
        authority.
      </p>

      <h2 className={H2}>Children</h2>
      <p className={P}>
        GroundsRoute is a tool for businesses and is not directed at children.
        We do not knowingly collect information from anyone under 16. If you
        create a crew login for a young employee, you are responsible for having
        the right to provide their details.
      </p>

      <h2 className={H2}>International transfers</h2>
      <p className={P}>
        Our providers listed above may process data in countries other than your
        own, including the United States. Where that happens we rely on the
        safeguards those providers put in place for international transfers.
      </p>

      <h2 className={H2}>Changes and contact</h2>
      <p className={P}>
        If we change this policy materially we will tell you by email or in the
        app before the change takes effect. Questions, requests or complaints
        can go to {LEGAL.contactEmail}. Our{" "}
        <Link href="/terms" className="underline underline-offset-4">
          Terms of Service
        </Link>{" "}
        cover the rest of the relationship.
      </p>
    </article>
  );
}
