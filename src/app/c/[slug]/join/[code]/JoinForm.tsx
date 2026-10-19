"use client";

import { useActionState } from "react";
import Link from "next/link";
import { joinCrew } from "./actions";
import PasswordField from "@/components/PasswordField";

const FIELD = "field px-4 py-3 text-base";

export default function JoinForm({ code, loginPath }: { code: string; loginPath: string }) {
  const [state, action, pending] = useActionState(joinCrew, undefined);

  if (state?.done) {
    return (
      <div className="card p-5">
        <p className="text-lg font-semibold">You&apos;re signed up.</p>
        <p className="mt-1 text-base">
          Tell your manager so they can approve you. After that, sign in here and bookmark the page:
        </p>
        <Link href={loginPath} className="mt-4 w-full btn btn-primary btn-lg">
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="code" value={code} />
      <div>
        <label htmlFor="name" className="mb-1 block text-sm font-medium">Your name</label>
        <input id="name" name="name" autoComplete="name" required className={FIELD} />
      </div>
      <div>
        <label htmlFor="username" className="mb-1 block text-sm font-medium">Username</label>
        <input
          id="username"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          required
          className={FIELD}
        />
      </div>
      <div>
        <label htmlFor="pin" className="mb-1 block text-sm font-medium">6-digit PIN</label>
        <PasswordField
          id="pin"
          name="pin"
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          autoComplete="new-password"
          required
          className={`${FIELD} tracking-[0.5em]`}
        />
      </div>
      <div>
        <label htmlFor="confirm" className="mb-1 block text-sm font-medium">PIN again</label>
        <PasswordField
          id="confirm"
          name="confirm"
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          autoComplete="new-password"
          required
          className={`${FIELD} tracking-[0.5em]`}
        />
      </div>
      {state?.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className="w-full btn btn-primary btn-lg">
        {pending ? "Signing up…" : "Sign up"}
      </button>
    </form>
  );
}
