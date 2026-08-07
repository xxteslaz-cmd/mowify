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
 * Stripe Checkout session expires on its own. The margin means no payment can
 * arrive for a row that has already been swept.
 */
export const CLAIM_TTL_MS = 48 * 60 * 60 * 1000;
