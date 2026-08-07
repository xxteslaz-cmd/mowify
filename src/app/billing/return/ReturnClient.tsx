"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { claimAccount, type ClaimState } from "./actions";

const POLL_MS = 1_500;
const GIVE_UP_MS = 60_000;

export default function ReturnClient() {
  const router = useRouter();
  const [state, setState] = useState<ClaimState>({ status: "pending" });
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();

    async function poll() {
      const next = await claimAccount();
      if (cancelled) return;

      setState(next);

      if (next.status === "ready") {
        router.replace("/dashboard");
        return;
      }

      if (next.status === "failed") return;

      if (Date.now() - startedAt > GIVE_UP_MS) {
        setTimedOut(true);
        return;
      }

      setTimeout(poll, POLL_MS);
    }

    poll();
    return () => {
      cancelled = true;
    };
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
        <Link className="btn btn-primary mt-4" href="/billing/return">
          Refresh
        </Link>
      ) : null}
    </div>
  );
}
