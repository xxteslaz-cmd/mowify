/**
 * The subscription price, defined once.
 *
 * It is stated in at least three places that must never disagree: the
 * trial-ending reminder email (which Terms section 3 obliges to name the
 * amount), the published Terms themselves, and the pricing page. A number
 * copied into three files is a number that eventually contradicts a contract.
 *
 * This is the *display* price. Stripe holds the authoritative one, keyed by
 * STRIPE_PRICE_ID, and is what actually charges the card. Changing the price
 * means changing it in Stripe and here, and Terms section 4 promises customers
 * 30 days' notice by email before a change reaches them.
 */
export const PRICE = {
  /** Cents, to avoid the float arithmetic that eventually loses a penny. */
  amountCents: 4900,
  interval: "month",
  currency: "USD",
} as const;

/** The trial length offered to a company that has never subscribed before. */
export const TRIAL_DAYS = 30;

/** e.g. "$49" — no trailing ".00", which reads as a price list, not prose. */
export function formatPrice(cents: number = PRICE.amountCents): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars)
    ? `$${dollars}`
    : `$${dollars.toFixed(2)}`;
}

/** e.g. "$49 per month" — the phrasing used in prose and in email. */
export function pricePerInterval(): string {
  return `${formatPrice()} per ${PRICE.interval}`;
}
