"use client";

import { useActionState } from "react";
import { crewLogin } from "./actions";
import PasswordField from "@/components/PasswordField";

const FIELD = "field px-4 py-3 text-base";

export default function CrewLoginForm({ orgId }: { orgId: string }) {
  const [state, action, pending] = useActionState(crewLogin, undefined);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="orgId" value={orgId} />

      <div>
        <label htmlFor="username" className="mb-1 block text-sm font-medium">
          Username
        </label>
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
        <label htmlFor="pin" className="mb-1 block text-sm font-medium">
          PIN
        </label>
        <PasswordField
          id="pin"
          name="pin"
          // Brings up the number pad instead of the full keyboard on a phone.
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          autoComplete="current-password"
          required
          className={`${FIELD} tracking-[0.5em]`}
        />
      </div>

      {state?.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full btn btn-primary btn-lg"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
