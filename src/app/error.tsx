"use client"; // Error boundaries must be Client Components.

import Link from "next/link";
import { useEffect } from "react";

/**
 * Catches render failures on the public routes — the landing page, /login,
 * /signup and the token pages — and anything that bubbles past a nested
 * boundary. It renders inside the root layout, so the app's fonts and design
 * tokens are available here.
 */
export default function Error({
  error,
  // Not `reset`: this Next version passes `unstable_retry`, which re-fetches
  // and re-renders the segment rather than only clearing the error state.
  // Almost every failure here is a database or network blip, so re-running the
  // read is what actually recovers.
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    // The server has already logged the real error; this surfaces the
    // client-side view of it in the browser console for support calls.
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-16">
      <div className="card w-full max-w-md p-6 text-center">
        <h1 className="text-xl font-semibold text-foreground">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm text-muted">
          This one is on us, not on you. Trying again usually clears it.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={() => unstable_retry()}
            className="btn btn-primary"
          >
            Try again
          </button>
          <Link href="/" className="btn btn-secondary">
            Go to the home page
          </Link>
        </div>
        {/* Production redacts the message and leaves only this hash, which is
            the only thing that ties a customer's report to a server log. */}
        {error.digest && (
          <p className="mt-6 text-xs text-muted">
            Reference code: <span className="font-mono">{error.digest}</span>
          </p>
        )}
      </div>
    </div>
  );
}
