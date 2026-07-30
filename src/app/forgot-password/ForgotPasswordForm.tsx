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
          className="field"
        />
      </div>

      {state?.error && (
        <p role="status" className="text-sm text-muted">
          {state.error}
        </p>
      )}

      <button type="submit" disabled={pending} className="w-full btn btn-primary">
        {pending ? "Sending…" : "Send reset link"}
      </button>
    </form>
  );
}
