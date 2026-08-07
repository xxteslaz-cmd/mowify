// Separate from cookie.ts's SESSION_COOKIE so src/proxy.ts can stay free of
// anything that pulls Prisma into a module running on every request.

/**
 * Identifies the browser that started a signup, so only that browser can claim
 * the account once Stripe confirms payment. No identifier rides in the return
 * URL: a URL is shared, logged, and leaked in Referer headers, and a cookie is
 * not.
 */
export const CLAIM_COOKIE = "groundsroute_claim";

/**
 * Forty-eight hours, deliberately longer than the twenty-four after which a
 * Stripe Checkout session expires on its own, so a claim outlives the checkout
 * it was minted for.
 *
 * This is a bound on the visitor's side only: it caps how long a captured claim
 * value stays usable. It is emphatically NOT what keeps a paid row from being
 * swept — the window that binds there is Stripe's webhook retry, which starts
 * when checkout completes rather than when this was issued. See SWEEP_GRACE_MS.
 */
export const CLAIM_TTL_MS = 48 * 60 * 60 * 1000;

/**
 * How long past its expiry an unconsumed row must sit before the signup sweep
 * may delete it.
 *
 * Stripe retries a failed webhook for roughly three days, measured from the
 * completion rather than from when the visitor started. Somebody who completes
 * checkout at hour twenty-three is therefore still being retried at hour
 * ninety-six, while their row expired at forty-eight. Sweeping in that gap
 * produces exactly the outcome handle-event.ts calls the one worth any amount
 * of code to avoid: the customer holds a live subscription, and the retry finds
 * nothing to provision, logs "no pending signup" and answers 200. Seventy-two
 * hours past expiry puts the sweep at hour one hundred and twenty — a full day
 * clear of the last retry Stripe can send.
 */
export const SWEEP_GRACE_MS = 72 * 60 * 60 * 1000;
