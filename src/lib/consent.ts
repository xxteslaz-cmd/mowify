import { PRICE, TRIAL_DAYS, formatPrice, pricePerInterval } from "@/lib/pricing";

/**
 * The trial's auto-renewal disclosure, in one place.
 *
 * Rendered on the signup page above the button that leads to the card form,
 * and stored verbatim on the consent record. Those two must be the same words:
 * the record exists to prove what a customer was shown, and a record that
 * quotes a different sentence than the page displayed proves the opposite of
 * what it is for.
 *
 * The law being satisfied here is about the screen, not the contract. As the
 * drafting notes on the Terms put it, auto-renewal compliance "is a flow
 * problem, not a document problem" — the clause is worthless if the signup
 * screen does not match it. So the material terms appear before the card
 * rather than behind a link to the Terms.
 */
export const CONSENT_KIND = "TRIAL_SUBSCRIPTION";

/** Three years. AB 2863's minimum for retaining proof of consent. */
export const CONSENT_RETENTION_YEARS = 3;

export function consentExpiry(agreedAt: Date): Date {
  const expires = new Date(agreedAt);
  expires.setFullYear(expires.getFullYear() + CONSENT_RETENTION_YEARS);
  return expires;
}

/**
 * The four material terms: what the trial is, what happens when it ends, how
 * much, and how to stop it.
 *
 * A plain string rather than markup so the identical text can be shown on the
 * page, stored as evidence, and restated in the acknowledgement email without
 * three renderings that can drift.
 */
export function trialDisclosure(): string {
  return [
    `Your free trial lasts ${TRIAL_DAYS} days and costs nothing.`,
    `A valid payment card is required to start it.`,
    `Unless you cancel before the trial ends, your subscription begins automatically on day ${TRIAL_DAYS + 1} and your card is charged ${pricePerInterval()}, and ${formatPrice()} again each ${PRICE.interval} after that, until you cancel.`,
    `You can cancel at any time from your billing page, in a few clicks, without contacting us. Cancel before the trial ends and you are never charged.`,
    `We will email you a reminder at least 7 days before the trial ends.`,
  ].join(" ");
}

/** The date a trial started today would convert. Shown next to the checkbox. */
export function trialConversionDate(from: Date = new Date()): Date {
  const converts = new Date(from);
  converts.setDate(converts.getDate() + TRIAL_DAYS);
  return converts;
}

export function formatConversionDate(date: Date = trialConversionDate()): string {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
