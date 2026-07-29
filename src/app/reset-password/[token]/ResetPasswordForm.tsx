"use client";

import { useActionState } from "react";
import { completeReset } from "./actions";
import PasswordField from "@/components/PasswordField";

export default function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(completeReset, undefined);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />

      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium">
          New password
        </label>
        <PasswordField
          id="password"
          name="password"
          autoComplete="new-password"
          required
          className="w-full rounded-lg border border-black/15 px-3 py-2 text-sm dark:border-white/15 dark:bg-transparent"
        />
      </div>

      {state?.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {pending ? "Saving…" : "Set new password"}
      </button>
    </form>
  );
}
