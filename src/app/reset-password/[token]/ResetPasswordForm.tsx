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
          className="field"
        />
      </div>

      {state?.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}

      <button type="submit" disabled={pending} className="w-full btn btn-primary">
        {pending ? "Saving…" : "Set new password"}
      </button>
    </form>
  );
}
