"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { claimAccount, type ClaimState } from "./actions";
import { startPolling } from "./poll";

export default function ReturnClient() {
  const router = useRouter();
  const [state, setState] = useState<ClaimState>({ status: "pending" });
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    return startPolling(claimAccount, {
      onState: setState,
      onReady: () => router.replace("/dashboard"),
      onTimeout: () => setTimedOut(true),
    });
  }, [router]);

  if (state.status === "failed") {
    return (
      <div className="card mx-auto mt-16 max-w-md p-6 text-center">
        <h1 className="text-lg font-semibold">We could not finish setting up</h1>
        <p className="mt-2 text-sm text-muted">
          {state.reason === "email-taken"
            ? "That email address is already registered. Your card has not been charged and the subscription was cancelled."
            : "We could not match this browser to a signup. If you have already paid, try signing in."}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <Link className="btn btn-primary" href="/login">
            Sign in
          </Link>
          <Link className="btn btn-secondary" href="/forgot-password">
            Reset password
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="card mx-auto mt-16 max-w-md p-6 text-center">
      <h1 className="text-lg font-semibold">Setting up your account</h1>
      <p className="mt-2 text-sm text-muted">
        {timedOut
          ? "This is taking longer than usual. Your payment went through — refresh this page, or sign in if you already have."
          : "Confirming your payment with Stripe. This usually takes a couple of seconds."}
      </p>
      {timedOut ? (
        <div className="mt-4 flex justify-center gap-2">
          {/*
            A <Link> back to this same route would not work here: the App
            Router reconciles the existing ReturnClient in place rather than
            remounting it, so the polling effect would never re-run and this
            button would look identical to the state it's meant to escape.
            A real reload is what actually restarts the poll.
          */}
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => window.location.reload()}
          >
            Refresh
          </button>
          <Link className="btn btn-secondary" href="/login">
            Sign in
          </Link>
        </div>
      ) : null}
    </div>
  );
}
