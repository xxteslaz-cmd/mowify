"use client";

import { useActionState } from "react";
import { confirmEmail } from "./actions";

export default function ConfirmForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(confirmEmail, undefined);

  return (
    <form action={action}>
      <input type="hidden" name="token" value={token} />

      {state?.error && (
        <p role="alert" className="mb-3 text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="inline-block rounded-lg bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {pending ? "Confirming…" : "Confirm my email"}
      </button>
    </form>
  );
}
