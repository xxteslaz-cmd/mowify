"use client";

import { useActionState } from "react";
import { signup } from "./actions";

const FIELD =
  "w-full rounded-lg border border-black/15 px-3 py-2 text-sm dark:border-white/15 dark:bg-transparent";

export default function SignupForm() {
  const [state, action, pending] = useActionState(signup, undefined);

  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="name" className="mb-1 block text-sm font-medium">
          Your name
        </label>
        <input id="name" name="name" required className={FIELD} />
        {state?.errors?.name && (
          <p className="mt-1 text-sm text-red-600 dark:text-red-400">
            {state.errors.name}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="companyName" className="mb-1 block text-sm font-medium">
          Company name
        </label>
        <input id="companyName" name="companyName" required className={FIELD} />
        {state?.errors?.companyName && (
          <p className="mt-1 text-sm text-red-600 dark:text-red-400">
            {state.errors.companyName}
          </p>
        )}
      </div>

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
          className={FIELD}
        />
        {state?.errors?.email && (
          <p className="mt-1 text-sm text-red-600 dark:text-red-400">
            {state.errors.email}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          className={FIELD}
        />
        {state?.errors?.password && (
          <p className="mt-1 text-sm text-red-600 dark:text-red-400">
            {state.errors.password}
          </p>
        )}
      </div>

      {state?.error && (
        <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {pending ? "Creating…" : "Create company"}
      </button>
    </form>
  );
}
