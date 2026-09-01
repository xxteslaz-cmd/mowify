import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import proxy from "@/proxy";
import { SESSION_COOKIE } from "@/lib/auth/cookie";

/**
 * The public-path list in proxy.ts is matched with `startsWith`, which has
 * already produced one real bug in this project: a prefix that is too short
 * silently publishes every route beneath it. These tests pin both directions —
 * what must be reachable signed out, and what must never be — so that adding
 * an entry to the list cannot quietly expose a neighbouring route.
 */
function visit(pathname: string, { signedIn = false } = {}) {
  const req = new NextRequest(new URL(`http://localhost:3000${pathname}`), {
    headers: signedIn ? { cookie: `${SESSION_COOKIE}=whatever` } : {},
  });
  return proxy(req);
}

function isRedirectToLogin(res: Response) {
  return (
    res.status === 307 &&
    (res.headers.get("location") ?? "").endsWith("/login")
  );
}

function isAllowedThrough(res: Response) {
  return res.headers.get("x-middleware-next") === "1";
}

describe("proxy public paths", () => {
  it.each([
    ["/", "the landing page, matched exactly rather than as a prefix"],
    ["/login", "the owner sign-in form"],
    ["/signup", "account creation"],
    ["/c/acme-lawn", "crew sign-in for one company"],
    ["/forgot-password", "starting a password reset"],
    ["/reset-password/sometoken", "finishing a password reset"],
    ["/verify-email/sometoken", "confirming an address"],
    ["/account/change-email/sometoken", "opened from the new address"],
    ["/billing/return", "the visitor arrives here straight from Stripe"],
    ["/api/stripe/webhook", "Stripe carries no session cookie"],
    ["/api/cron/trial-reminder", "Vercel Cron carries no session cookie either"],
    ["/terms", "must render for someone with no account"],
    ["/privacy", "must render for someone with no account"],
  ])("allows %s signed out (%s)", (pathname) => {
    expect(isAllowedThrough(visit(pathname))).toBe(true);
  });

  it.each([
    ["/dashboard"],
    ["/customers"],
    ["/customers/some-id"],
    ["/team"],
    ["/account"],
    ["/crew/some-id/today"],
    // The one AGENTS.md calls out by name: "/billing" must not be public, even
    // though "/billing/return" is. A prefix entry of "/billing" would make the
    // owner's billing page readable by anyone.
    ["/billing"],
    // "/api/cron/" is public with its trailing slash, which must not be short
    // enough to publish anything alongside it. These two would both be caught
    // by a prefix of "/api/" or "/api/cron".
    ["/api/cronjobs"],
    ["/api/stripe/refund"],
  ])("redirects %s to /login when signed out", (pathname) => {
    expect(isRedirectToLogin(visit(pathname))).toBe(true);
  });

  it("lets a request with a session cookie through to a protected route", () => {
    expect(isAllowedThrough(visit("/dashboard", { signedIn: true }))).toBe(true);
  });

  it("does not treat an unknown route as public", () => {
    // The default case is the protection: a new top-level route is guarded
    // until someone deliberately adds it to the list.
    expect(isRedirectToLogin(visit("/some-future-route"))).toBe(true);
  });

  it("does not let a path merely containing a public segment through", () => {
    // startsWith, not includes — "/dashboard/login" must stay protected.
    expect(isRedirectToLogin(visit("/dashboard/login"))).toBe(true);
  });
});
