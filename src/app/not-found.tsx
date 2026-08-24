import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Page not found",
};

/**
 * The 404. It sits at the root so it covers both the public routes and the
 * authenticated ones; it renders inside the root layout rather than the app
 * shell, so there is no sidebar here and the links below are the only way
 * out. /dashboard is offered first because a signed-in owner is the likeliest
 * visitor — a mistyped or stale URL — and a signed-out one is redirected to
 * /login by src/proxy.ts the moment they follow it.
 */
export default function NotFound() {
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
          <Link href="/dashboard" className="btn btn-primary">
            Go to your dashboard
          </Link>
          <Link href="/" className="btn btn-secondary">
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}
