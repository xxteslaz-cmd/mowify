import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import proxy, { classify } from "@/proxy";
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
    ["/pricing", "the Terms cite this page for the rates"],
    ["/faq", "answers prospects' questions and takes new ones"],
    // All three of these were redirected to /login in production. A crawler
    // that gets a redirect instead of robots.txt applies none of the disallow
    // rules that keep /c/<company-slug> and the token routes out of search
    // indexes, and an og:image that resolves to a login page means no shared
    // link anywhere has a preview.
    ["/robots.txt", "crawlers must read the disallow list, not a redirect"],
    ["/sitemap.xml", "unreachable means never indexed"],
    ["/opengraph-image", "link previews resolve this with no session"],
    [
      "/opengraph-image?23b858275e0f3350",
      "the real request carries a cache-busting query, which is not in pathname",
    ],
    ["/manifest.webmanifest", "read when a crew adds the app to a home screen"],
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
    // The signed-in side of "/". Reached directly with no session it must
    // not render the landing page's session logic for a stranger.
    ["/home"],
    // Site administration. requireSiteAdmin is the real gate; a signed-out
    // visitor should not even reach it.
    ["/admin/questions"],
  ])("redirects %s to /login when signed out", (pathname) => {
    expect(isRedirectToLogin(visit(pathname))).toBe(true);
  });

  it("lets a request with a session cookie through to a protected route", () => {
    expect(isAllowedThrough(visit("/dashboard", { signedIn: true }))).toBe(true);
  });

  it.each([
    ["/some-future-route"],
    ["/blog"],
    // The generated metadata files are matched exactly, not by prefix. If they
    // ever move into PUBLIC_PREFIXES these start classifying as public, which
    // is the whole reason they are a separate list.
    ["/robots.txt/secret"],
    ["/sitemap.xml/secret"],
    ["/opengraph-image-internal"],
  ])("lets unknown path %s through to the 404 page, not /login", (pathname) => {
    // A redirect here made every mistyped link a login form and told crawlers
    // that any URL at all was a live page.
    expect(classify(pathname)).toBe("unknown");
    expect(isAllowedThrough(visit(pathname))).toBe(true);
  });

  it("does not let a path merely containing a public segment through", () => {
    // startsWith, not includes — "/dashboard/login" must stay protected.
    expect(isRedirectToLogin(visit("/dashboard/login"))).toBe(true);
  });
});

describe("proxy landing page", () => {
  function rewriteTarget(res: Response) {
    return res.headers.get("x-middleware-rewrite");
  }

  it("serves the prerendered landing page to a visitor with no session", () => {
    const res = visit("/");
    expect(isAllowedThrough(res)).toBe(true);
    expect(rewriteTarget(res)).toBeNull();
  });

  it("rewrites / to /home when a session cookie is present", () => {
    // The static page cannot read the session, so without this a signed-in
    // owner would be shown the marketing page instead of their dashboard.
    const target = rewriteTarget(visit("/", { signedIn: true }));
    expect(target && new URL(target).pathname).toBe("/home");
  });
});

/**
 * PROTECTED_SEGMENTS is an allow-list, so a route added without updating
 * proxy.ts would be reachable signed out with only the DAL in front of it.
 * This walks src/app and fails for any route the proxy does not classify,
 * which is what keeps new routes protected unless someone decides otherwise.
 */
describe("proxy route coverage", () => {
  const APP_DIR = path.join(__dirname, "app");
  // File conventions that produce a URL, and the URL they produce when it is
  // not simply the directory path.
  const ROUTE_FILES: Record<string, string | null> = {
    "page.tsx": null,
    "route.ts": null,
    "robots.ts": "/robots.txt",
    "sitemap.ts": "/sitemap.xml",
    "manifest.ts": "/manifest.webmanifest",
    "opengraph-image.tsx": "/opengraph-image",
  };

  function routes(dir: string, segments: string[] = []): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        // (group) folders add nothing to the URL; [param] gets a sample value.
        const segment = /^\(.*\)$/.test(entry.name)
          ? null
          : entry.name.replace(/^\[.*\]$/, "sample");
        found.push(
          ...routes(
            path.join(dir, entry.name),
            segment ? [...segments, segment] : segments,
          ),
        );
      } else if (entry.name in ROUTE_FILES) {
        found.push(ROUTE_FILES[entry.name] ?? "/" + segments.join("/"));
      }
    }
    return found;
  }

  const all = routes(APP_DIR);

  it("finds the routes it is meant to check", () => {
    // Guards the walk itself: a broken walk that finds nothing passes below.
    expect(all).toEqual(
      expect.arrayContaining(["/", "/dashboard", "/api/export", "/robots.txt"]),
    );
  });

  it.each(all.map((r) => [r]))(
    "classifies %s as public or protected",
    (route) => {
      expect(classify(route)).not.toBe("unknown");
    },
  );
});
