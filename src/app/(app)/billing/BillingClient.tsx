"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  openBillingPortal,
  pauseSubscription,
  resumeSubscription,
  startResubscribe,
} from "./actions";

export default function BillingClient({
  canRestart,
  canManage,
  canPause,
  paused,
  resumeLimits,
  price,
  earlyResumeFrom,
}: {
  canRestart: boolean;
  canManage: boolean;
  canPause: boolean;
  paused: boolean;
  resumeLimits: { min: string; max: string };
  price: string;
  /** Set while the one-month minimum still holds; the date it lifts. */
  earlyResumeFrom: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [pausing, setPausing] = useState(false);
  const [resumeDate, setResumeDate] = useState(resumeLimits.min);

  // Pause and resume stay on this page, so a success is a refresh rather than
  // a redirect.
  function act(action: () => Promise<{ ok: true } | { error: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setPausing(false);
      router.refresh();
    });
  }

  function confirmPause() {
    const on = new Date(`${resumeDate}T00:00:00Z`).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    });
    // The inline warning is the real disclosure; this is the last chance to
    // back out of something that cannot be undone for a month.
    if (
      window.confirm(
        `Pause until ${on}?\n\n` +
          "Your account becomes read-only straight away, and you can't resume for at least a month.\n\n" +
          `Billing restarts automatically on ${on} at ${price}.`,
      )
    ) {
      act(() => pauseSubscription(resumeDate));
    }
  }

  function confirmResume() {
    if (
      window.confirm(
        `Resume now?\n\nYour card is charged ${price} today, minus credit for any unused days from before you paused, and your billing date moves to today.`,
      )
    ) {
      act(resumeSubscription);
    }
  }

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

      {paused ? (
        <div className="mt-6 border-t pt-6">
          <h2 className="font-medium">Resume early</h2>
          {earlyResumeFrom ? (
            <p className="mt-2 text-sm text-muted">
              Pauses last at least a month. You can resume early from{" "}
              {earlyResumeFrom}.
            </p>
          ) : (
            <>
              <p className="mt-2 text-sm">
                Resuming charges your card {price} today and moves your billing
                date to today. Everything unlocks as soon as the payment goes
                through.
              </p>
              <button
                className="btn btn-primary mt-3"
                onClick={confirmResume}
                disabled={pending}
              >
                {pending ? "Resuming…" : "Resume now"}
              </button>
            </>
          )}
        </div>
      ) : null}

      {canPause ? (
        <div className="mt-6 border-t pt-6">
          <h2 className="font-medium">Off for the season?</h2>
          {!pausing ? (
            <>
              <p className="mt-2 text-sm text-muted">
                Pause your subscription for one to six months instead of
                cancelling. Nothing is charged while you&apos;re paused.
              </p>
              <button
                className="btn btn-secondary mt-3"
                onClick={() => setPausing(true)}
              >
                Pause subscription
              </button>
            </>
          ) : (
            <div className="mt-3">
              <div
                role="note"
                className="card border-danger/30 bg-danger/10 p-4 text-sm"
              >
                <p className="font-medium">Before you pause</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  <li>
                    Your account goes read-only straight away. You won&apos;t be
                    able to add or change jobs, customers or crews.
                  </li>
                  <li>
                    The minimum pause is one month. You can&apos;t resume before
                    then.
                  </li>
                  <li>
                    Billing restarts automatically on the date you pick, at{" "}
                    {price}. You&apos;ll get credit for the unused days of this
                    month on that bill.
                  </li>
                  <li>Your schedule, customers and crews are all kept.</li>
                </ul>
              </div>
              <label className="mt-4 block text-sm" htmlFor="resume-date">
                Resume on
              </label>
              <input
                id="resume-date"
                type="date"
                className="field mt-1 max-w-xs"
                min={resumeLimits.min}
                max={resumeLimits.max}
                value={resumeDate}
                onChange={(e) => setResumeDate(e.target.value)}
                required
              />
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  className="btn btn-primary"
                  onClick={confirmPause}
                  disabled={pending || !resumeDate}
                >
                  {pending ? "Pausing…" : "Pause until this date"}
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => setPausing(false)}
                  disabled={pending}
                >
                  Keep my subscription
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
