"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signup } from "./actions";
import PasswordField from "@/components/PasswordField";

const FIELD = "field";

export default function SignupForm({
  disclosure,
  convertsOn,
  price,
}: {
  disclosure: string;
  convertsOn: string;
  price: string;
}) {
  const [state, action, pending] = useActionState(signup, undefined);

  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="name" className="mb-1 block text-sm font-medium">
          Your name
        </label>
        <input id="name" name="name" required className={FIELD} />
        {state?.errors?.name && (
          <p className="mt-1 text-sm text-danger">
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
          <p className="mt-1 text-sm text-danger">
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
          <p className="mt-1 text-sm text-danger">
            {state.errors.email}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium">
          Password
        </label>
        <PasswordField
          id="password"
          name="password"
          autoComplete="new-password"
          required
          className={FIELD}
        />
        {state?.errors?.password && (
          <p className="mt-1 text-sm text-danger">
            {state.errors.password}
          </p>
        )}
      </div>

      {/* Above the button that leads to the card form, not behind a link to
          the Terms. The material terms of a negative option have to be where
          the customer is deciding, which is here. */}
      <div className="card bg-brand-soft p-4 text-sm leading-relaxed">
        <p className="font-medium">Before you start your free trial</p>
        <p className="mt-2 text-muted">{disclosure}</p>
      </div>

      <div className="space-y-3">
        {/* Two separate boxes, neither pre-ticked. Express consent to the
            auto-renewal has to be separable from general agreement to the
            Terms — one box covering both does not isolate it. */}
        <label className="flex items-start gap-2 text-sm leading-relaxed">
          <input
            type="checkbox"
            name="trialConsent"
            className="mt-1 shrink-0"
          />
          <span>
            I understand my trial converts to a paid subscription on{" "}
            <strong>{convertsOn}</strong> and my card will be charged{" "}
            <strong>{price}</strong> unless I cancel first.
          </span>
        </label>
        {state?.errors?.trialConsent && (
          <p className="text-sm text-danger">{state.errors.trialConsent}</p>
        )}

        <label className="flex items-start gap-2 text-sm leading-relaxed">
          <input
            type="checkbox"
            name="termsConsent"
            className="mt-1 shrink-0"
          />
          <span>
            I agree to the{" "}
            <Link href="/terms" className="underline underline-offset-4">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="underline underline-offset-4">
              Privacy Policy
            </Link>
            .
          </span>
        </label>
        {state?.errors?.termsConsent && (
          <p className="text-sm text-danger">{state.errors.termsConsent}</p>
        )}
      </div>

      {state?.error && (
        <p className="text-sm text-danger">{state.error}</p>
      )}

      <button type="submit" disabled={pending} className="w-full btn btn-primary">
        {pending ? "Creating…" : "Start free trial"}
      </button>
    </form>
  );
}
