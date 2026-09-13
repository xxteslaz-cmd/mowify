import { NextResponse, type NextRequest } from "next/server";
// Imported from cookie.ts, not session.ts, so this runs without pulling Prisma
// into a module that executes on every request.
import { SESSION_COOKIE } from "@/lib/auth/cookie";

// Only the sign-in surfaces are reachable signed out. Everything else is
// bounced to /login before it renders.
const PUBLIC_PREFIXES = [
  "/login",
  "/signup",
  "/c/",
  "/forgot-password",
  "/reset-password/",
  "/verify-email/",
  // The confirm link is emailed to the NEW address, which the owner may open
  // on a device or browser that has no session cookie for this account at
  // all — unlike the request form, which lives on /account itself and so is
  // already protected by the default case below.
  "/account/change-email/",
  // The visitor arrives here straight from Stripe with no session at all —
  // the account may not even exist yet. This is the one page whose whole job
  // is to run before a session exists.
  "/billing/return",
  // Stripe is not a browser and carries no session cookie.
  "/api/stripe/webhook",
  // Neither is Vercel Cron. The trailing slash is load-bearing: these are
  // matched with startsWith, and this repo has already shipped one bug from a
  // prefix short enough to publish its neighbours. "/api/cron/" can only ever
  // match routes under it, and each of those authenticates itself against
  // CRON_SECRET — being exempt from the session redirect is not the same as
  // being unauthenticated.
  "/api/cron/",
  // Linked from the landing page and from signup, so both have to render for
  // someone who has no account yet — which is the whole point of publishing
  // them. Neither is a prefix of another route.
  "/terms",
  "/privacy",
  // Terms section 4 cites this page for the rates, so it has to render for
  // someone deciding whether to sign up at all.
  "/pricing",
];

// Generated metadata files, matched exactly rather than by prefix.
//
// These are files, not route subtrees, so nothing can ever legitimately nest
// beneath them and an exact match costs nothing. It also keeps them out of
// PUBLIC_PREFIXES, where every entry silently publishes everything under it —
// the hazard the comments above keep pointing at.
//
// All three were redirected to /login until this list existed, and each failure
// was invisible from inside the app. robots.txt is the worst of them: the
// disallow list in robots.ts is what keeps /c/<company-slug> crew logins and
// the token routes out of search indexes, and a crawler that gets a redirect
// instead applies no rules at all. The Open Graph image is the most public —
// og:image resolving to a login page means every link shared to Slack,
// iMessage or Facebook has no preview. The request for it carries a cache-
// busting query string, which is not part of pathname, so this still matches.
const PUBLIC_FILES = ["/robots.txt", "/sitemap.xml", "/opengraph-image"];

export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Exact match, not a prefix: every route starts with "/", so adding it to
  // PUBLIC_PREFIXES would make pathname.startsWith("/") true for the whole
  // site and quietly remove the signed-out redirect everywhere. The root
  // itself renders a public landing page when signed out (see src/app/page.tsx)
  // but every other route must still fall through to the check below.
  if (pathname === "/") {
    return NextResponse.next();
  }

  if (PUBLIC_FILES.includes(pathname)) {
    return NextResponse.next();
  }

  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Presence only. This runs on every request including prefetches, so it must
  // not query the database — the DAL is the real check, next to the data.
  if (!req.cookies.get(SESSION_COOKIE)) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }

  return NextResponse.next();
}

export const config = {
  // Deny-list of static asset extensions actually served from public/, kept
  // as an extension list rather than a path prefix so a new top-level route
  // is protected by default instead of needing to be added here.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg)$).*)"],
};
