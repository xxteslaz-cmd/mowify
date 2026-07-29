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
];

export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

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
