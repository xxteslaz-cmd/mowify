"use client";

import { useActionState } from "react";
import { crewLogin } from "./actions";
import PasswordField from "@/components/PasswordField";

const FIELD =
  "w-full rounded-lg border border-black/15 px-4 py-3 text-base dark:border-white/15 dark:bg-transparent";

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
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-black px-4 py-3 text-base font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
