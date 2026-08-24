"use client"; // Error boundaries must be Client Components.

import { useEffect } from "react";

/**
 * Catches render failures inside the authenticated shell. It renders in place
 * of the page but *within* `(app)/layout.tsx`, so the sidebar and the user
 * menu stay on screen and the owner can navigate somewhere else instead of
 * being dropped onto a blank document.
 *
 * The audience here includes crews on a phone in someone's yard, so the retry
 * is a full-width touch target on small screens rather than a small button.
 */
export default function AppError({
  error,
  // Not `reset`: this Next version passes `unstable_retry`, which re-fetches
  // the segment's data instead of only clearing the error state.
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="card mx-auto max-w-md p-6">
        <h1 className="text-xl font-semibold text-foreground">
          This page didn&apos;t load
        </h1>
        <p className="mt-2 text-sm text-muted">
          Something failed while loading this screen. Nothing you have already
          saved is affected — try again, and if it keeps happening, send us the
          reference code below.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => unstable_retry()}
            className="btn btn-primary btn-lg w-full sm:w-auto"
          >
            Try again
          </button>
        </div>
        {error.digest && (
          <p className="mt-6 text-xs text-muted">
            Reference code: <span className="font-mono">{error.digest}</span>
          </p>
        )}
      </div>
    </div>
  );
}
