import Link from "next/link";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth/cookie";

export const metadata: Metadata = {
  title: "Page not found",
};

/**
 * The 404. It sits at the root so it covers both the public routes and the
 * authenticated ones; it renders inside the root layout rather than the app
 * shell, so there is no sidebar here and the links below are the only way
 * out. /dashboard is offered only when a session cookie is present: a
 * signed-out visitor (a mistyped /c/<slug> crew link, say) would just be
 * bounced to /login by src/proxy.ts. Presence only, like the proxy — this is
 * a choice of link, not an authorization check.
 */
export default async function NotFound() {
  const signedIn = (await cookies()).has(SESSION_COOKIE);

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-16">
      <div className="card w-full max-w-md p-6 text-center">
        <p className="text-sm font-semibold text-brand">404</p>
        <h1 className="mt-2 text-xl font-semibold text-foreground">
          We couldn&apos;t find that page
        </h1>
        <p className="mt-2 text-sm text-muted">
          The link may be out of date, or the page may have been removed.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {signedIn && (
            <Link href="/dashboard" className="btn btn-primary">
              Go to your dashboard
            </Link>
          )}
          <Link
            href="/"
            className={signedIn ? "btn btn-secondary" : "btn btn-primary"}
          >
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}
