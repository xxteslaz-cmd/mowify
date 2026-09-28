import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Page not found",
};

/**
 * The 404. It sits at the root so it covers both the public routes and the
 * authenticated ones; it renders inside the root layout rather than the app
 * shell, so there is no sidebar here and the link below is the only way out.
 *
 * It must not read cookies or headers. This file is part of every route's
 * tree, and a request-time read here made /pricing, /terms and /privacy render
 * per request instead of being prerendered. One "Home" link serves everyone:
 * "/" already sends a signed-in owner to the dashboard and a crew member to
 * their day.
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
          <Link href="/" className="btn btn-primary">
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}
