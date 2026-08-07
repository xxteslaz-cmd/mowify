"use client";

import { useState, useTransition } from "react";
import { openBillingPortal } from "./actions";

export default function BillingClient() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function open() {
    setError(null);
    startTransition(async () => {
      const result = await openBillingPortal();
      if ("error" in result) {
        setError(result.error);
        return;
      }
      window.location.href = result.url;
    });
  }

  return (
    <div>
      <button className="btn btn-primary" onClick={open} disabled={pending}>
        {pending ? "Opening…" : "Manage billing"}
      </button>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
