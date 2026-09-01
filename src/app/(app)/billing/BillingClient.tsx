"use client";

import { useState, useTransition } from "react";
import { openBillingPortal, startResubscribe } from "./actions";

export default function BillingClient({
  canRestart,
  canManage,
}: {
  canRestart: boolean;
  canManage: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Both buttons do the same thing with the result — leave for a Stripe-hosted
  // page, or surface why we could not get there — so they share one handler
  // rather than two near-identical copies.
  function go(action: () => Promise<{ url: string } | { error: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if ("error" in result) {
        setError(result.error);
        return;
      }
      window.location.href = result.url;
    });
  }

  if (!canRestart && !canManage) {
    return (
      <p className="text-sm text-muted">
        No billing account is attached to this company yet.
      </p>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap gap-3">
        {canRestart ? (
          <button
            className="btn btn-primary"
            onClick={() => go(startResubscribe)}
            disabled={pending}
          >
            {pending ? "Opening…" : "Restart subscription"}
          </button>
        ) : null}

        {canManage ? (
          // Secondary whenever restarting is the thing that actually gets this
          // company working again; the portal is then only for invoices and
          // card details.
          <button
            className={canRestart ? "btn btn-secondary" : "btn btn-primary"}
            onClick={() => go(openBillingPortal)}
            disabled={pending}
          >
            {pending ? "Opening…" : "Manage billing"}
          </button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
