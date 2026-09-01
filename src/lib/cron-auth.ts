import { timingSafeEqual } from "crypto";

/**
 * Authorises a Vercel Cron invocation.
 *
 * Vercel sends `Authorization: Bearer $CRON_SECRET`. Shared by every cron route
 * rather than copied into each: one of these routes mails customers and another
 * deletes them, and a second copy of this logic is a second place for it to be
 * subtly weaker.
 *
 * **Fails closed when CRON_SECRET is unset.** Reading an absent secret as "no
 * auth required" would open these endpoints to anyone who guesses the path,
 * and it would do so exactly when the environment is misconfigured and nobody
 * is watching.
 */
export function cronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("CRON_SECRET is not set; refusing to run this cron route.");
    return false;
  }

  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return false;

  // Constant-time, so response timing does not leak how much of the secret was
  // correct. Lengths must match first — timingSafeEqual throws on mismatched
  // buffer lengths rather than returning false.
  const provided = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(secret);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

/**
 * The response for an unauthorised cron request.
 *
 * 404 rather than 401: a 401 confirms the route exists to whoever is probing
 * for it, and there is nothing to be gained by telling them.
 */
export function cronUnauthorized(): Response {
  return new Response(null, { status: 404 });
}
