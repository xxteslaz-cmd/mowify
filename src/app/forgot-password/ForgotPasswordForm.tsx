"use client";

import { useActionState } from "react";
import { requestReset } from "./actions";

export default function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestReset, undefined);

  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="w-full rounded-lg border border-black/15 px-3 py-2 text-sm dark:border-white/15 dark:bg-transparent"
        />
      </div>

      {state?.error && (
        <p role="status" className="text-sm text-black/70 dark:text-white/70">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {pending ? "Sending…" : "Send reset link"}
      </button>
    </form>
  );
}
