/**
 * Details that must appear in the Terms and the Privacy Policy but that only
 * the business owner can supply. They are gathered in one place so there is a
 * single thing to fill in, and they are rendered verbatim onto the pages so an
 * unfilled placeholder is visible to anyone who looks rather than hidden in a
 * config file nobody opens.
 *
 * These pages are a starting point written from what the software actually
 * does. They are not legal advice and have not been reviewed by a lawyer.
 */
export const LEGAL = {
  entity: "[REGISTERED BUSINESS NAME]",
  contactEmail: "[SUPPORT EMAIL ADDRESS]",
  jurisdiction: "[STATE OR COUNTRY OF INCORPORATION]",
  /** Update whenever the wording of either page changes materially. */
  lastUpdated: "23 August 2026",
} as const;

/** The third parties that necessarily receive data to run the service. */
export const SUBPROCESSORS = [
  {
    name: "Stripe",
    purpose:
      "Takes payment and stores your card details. Card numbers are entered on Stripe's own pages and never reach our servers.",
  },
  {
    name: "Neon",
    purpose: "Hosts the PostgreSQL database that holds your company's records.",
  },
  {
    name: "Vercel",
    purpose: "Hosts and serves the application itself.",
  },
  {
    name: "Resend",
    purpose:
      "Delivers transactional email — password resets, email verification and address changes.",
  },
] as const;
