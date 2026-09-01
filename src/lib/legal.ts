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
  // Filled in as a sole proprietorship: there is no company, so the counterparty
  // to every customer contract is the individual.
  entity: "Chad Slaughter",
  /** Rendered wherever the documents need the trading style spelled out. */
  entityLong: "Chad Slaughter, an individual doing business as GroundsRoute",
  /**
   * Still unfilled, and rendered verbatim so it is visible on the published
   * pages rather than hidden here. An invented address on a contract is worse
   * than an obvious blank.
   */
  mailingAddress: "[MAILING ADDRESS]",
  /** Venue for disputes, Terms section 15. */
  county: "Dauphin County",
  contactEmail: "support@groundsroute.com",
  jurisdiction: "the Commonwealth of Pennsylvania",
  /** Update whenever the wording of either page changes materially. */
  lastUpdated: "31 August 2026",
  /**
   * Stamped onto every consent record so a dispute can be answered with the
   * exact version of the Terms that was in force. Bump it whenever either
   * published document changes materially — the records already written keep
   * the version they were taken under.
   */
  version: "2026-08-31",
} as const;

/**
 * The retention windows the Privacy Policy publishes.
 *
 * The purge job reads these same values. A policy that says 30 days while the
 * code deletes at 45 is not a discrepancy, it is a false statement to
 * customers, and the only reliable way to prevent that is for there to be one
 * number rather than two that agree today.
 */
export const RETENTION = {
  /** Days of account data kept after a subscription lapses, then deleted. */
  accountDays: 30,
  /** Years consent records are kept — AB 2863's minimum. */
  consentYears: 3,
  /** Days of server logs, stated in the policy for accuracy only. */
  logDays: 90,
  /** Years of billing and tax records, kept because law requires it. */
  billingYears: 7,
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
