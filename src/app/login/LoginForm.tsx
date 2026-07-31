"use client";

import { useActionState } from "react";
import { login } from "./actions";
import PasswordField from "@/components/PasswordField";

export default function LoginForm() {
  const [state, action, pending] = useActionState(login, undefined);

  return (
    <form action={action} className="space-y-3">
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

      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium">
          Password
        </label>
        <PasswordField
          id="password"
          name="password"
          autoComplete="current-password"
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
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
