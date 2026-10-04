/**
 * Filters every Vercel Web Analytics event before it leaves the browser.
 *
 * These routes carry a single-use token in the path. A token in an analytics
 * dashboard is a password-reset link anyone with dashboard access could use,
 * so their page views are dropped entirely rather than redacted.
 *
 * Query strings are stripped for the same reason (Stripe's session_id on
 * /billing/return, anything a future page adds), except utm_* tags, which
 * are how outreach links say which channel a visitor came from.
 */
const TOKEN_PREFIXES = ["/reset-password/", "/verify-email/", "/account/change-email/"];

export function scrubAnalyticsUrl(raw: string): string | null {
  const url = new URL(raw);
  if (TOKEN_PREFIXES.some((p) => url.pathname.startsWith(p))) return null;

  const kept = new URLSearchParams();
  for (const [key, value] of url.searchParams) {
    if (key.startsWith("utm_")) kept.append(key, value);
  }
  url.search = kept.toString();
  url.hash = "";
  return url.toString();
}
