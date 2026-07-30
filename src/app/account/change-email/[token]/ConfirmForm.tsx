"use client";

import { useActionState } from "react";
import { confirmEmailChange } from "./actions";

export default function ConfirmForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(confirmEmailChange, undefined);

  return (
    <form action={action}>
      <input type="hidden" name="token" value={token} />

      {state?.error && (
        <p role="alert" className="mb-3 text-sm text-danger">
          {state.error}
        </p>
      )}

      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? "Confirming…" : "Confirm my new email"}
      </button>
    </form>
  );
}
