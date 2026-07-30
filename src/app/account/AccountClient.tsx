"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  changePassword,
  emailMyResetLink,
  resendVerification,
  requestEmailChange,
  cancelEmailChange,
} from "./actions";
import PasswordField from "@/components/PasswordField";

const FIELD =
  "w-full rounded-md border border-black/10 px-3 py-2 text-sm dark:border-white/10 dark:bg-transparent";

export default function AccountClient({
  email,
  verified,
  pendingEmail,
}: {
  email: string;
  verified: boolean;
  pendingEmail: string | null;
}) {
  const router = useRouter();
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [sent, setSent] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  const [linkMsg, setLinkMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newEmail, setNewEmail] = useState("");
  const [emailCurrentPassword, setEmailCurrentPassword] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailRequested, setEmailRequested] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);

  async function submitEmailChange(e: React.FormEvent) {
    e.preventDefault();
    setEmailBusy(true);
    setEmailError(null);
    setEmailRequested(false);
    // requestEmailChange returns its error rather than throwing, for the same
    // reason as changePassword: a production build redacts thrown Server
    // Action errors to an opaque digest.
    const result = await requestEmailChange({
      newEmail,
      currentPassword: emailCurrentPassword,
    });
    if (result?.error) {
      setEmailError(result.error);
    } else {
      setNewEmail("");
      setEmailCurrentPassword("");
      setEmailRequested(true);
      router.refresh();
    }
    setEmailBusy(false);
  }

  async function cancelPending() {
    setCancelBusy(true);
    try {
      await cancelEmailChange();
      router.refresh();
    } finally {
      setCancelBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(false);
    // changePassword returns its error rather than throwing, so a production
    // build still shows the real message instead of React's redacted digest.
    const result = await changePassword({ currentPassword, newPassword });
    if (result?.error) {
      setError(result.error);
    } else {
      setCurrent("");
      setNew("");
      setDone(true);
      router.refresh();
    }
    setBusy(false);
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <h1 className="mb-1 text-xl font-semibold">Account</h1>
      <p className="mb-6 text-sm text-black/60 dark:text-white/60">{email}</p>

      <div className="mb-6 rounded-lg border border-black/10 p-4 dark:border-white/10">
        <p className="mb-2 text-sm font-medium">Email</p>
        {verified ? (
          <p className="flex items-center gap-1.5 text-sm text-green-700 dark:text-green-400">
            <svg
              viewBox="0 0 16 16"
              aria-hidden="true"
              className="h-4 w-4 shrink-0 fill-current"
            >
              <path d="M8 0a8 8 0 100 16A8 8 0 008 0zm3.7 6.1l-4.2 4.2a.8.8 0 01-1.1 0L4.3 8.2a.8.8 0 111.1-1.1l1.5 1.5 3.7-3.6a.8.8 0 011.1 1.1z" />
            </svg>
            Confirmed
          </p>
        ) : (
          <>
            <p className="mb-3 text-sm text-black/60 dark:text-white/60">
              Not confirmed yet. Confirming means you can recover this account
              if you ever forget your password.
            </p>
            <button
              disabled={busy || sent}
              onClick={async () => {
                setBusy(true);
                try {
                  await resendVerification();
                  setSent(true);
                } finally {
                  setBusy(false);
                }
              }}
              className="rounded-md bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
            >
              {sent ? "Sent" : "Send confirmation email"}
            </button>
          </>
        )}
      </div>

      {pendingEmail && (
        <div className="mb-6 rounded-lg border border-black/10 p-4 dark:border-white/10">
          <p className="mb-2 text-sm font-medium">Pending email change</p>
          <p className="mb-3 text-sm text-black/60 dark:text-white/60">
            Waiting for {pendingEmail} to confirm. Your email stays{" "}
            {email} until then.
          </p>
          <button
            disabled={cancelBusy}
            onClick={cancelPending}
            className="rounded-md border border-black/10 px-3 py-2 text-sm font-medium disabled:opacity-50 dark:border-white/10"
          >
            Cancel
          </button>
        </div>
      )}

      <form
        onSubmit={submitEmailChange}
        className="mb-6 rounded-lg border border-black/10 p-4 dark:border-white/10"
      >
        <p className="mb-3 text-sm font-medium">Change email</p>

        <div className="space-y-3">
          <input
            type="email"
            placeholder="New email address"
            autoComplete="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            required
            className={FIELD}
          />
          <PasswordField
            placeholder="Current password"
            autoComplete="current-password"
            value={emailCurrentPassword}
            onChange={(e) => setEmailCurrentPassword(e.target.value)}
            required
            className={FIELD}
          />
        </div>

        {emailError && (
          <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
            {emailError}
          </p>
        )}
        {emailRequested && (
          <p role="status" className="mt-3 text-sm text-black/60 dark:text-white/60">
            Check the new address for a confirmation link. Nothing changes
            until it confirms.
          </p>
        )}

        <button
          type="submit"
          disabled={emailBusy}
          className="mt-3 rounded-md bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          Change email
        </button>
      </form>

      <form
        onSubmit={submit}
        className="rounded-lg border border-black/10 p-4 dark:border-white/10"
      >
        <p className="mb-3 text-sm font-medium">Change password</p>

        <div className="space-y-3">
          <PasswordField
            placeholder="Current password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrent(e.target.value)}
            required
            className={FIELD}
          />
          <PasswordField
            placeholder="New password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNew(e.target.value)}
            required
            className={FIELD}
          />
        </div>

        {error && (
          <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        {done && (
          <p role="status" className="mt-3 text-sm text-black/60 dark:text-white/60">
            Password changed. Other devices have been signed out.
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-3 rounded-md bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          Change password
        </button>

        <p className="mt-4 border-t border-black/10 pt-3 text-sm text-black/60 dark:border-white/10 dark:text-white/60">
          Don&apos;t know your current password?{" "}
          <button
            type="button"
            disabled={busy || linkSent}
            onClick={async () => {
              setBusy(true);
              setLinkMsg(null);
              try {
                const result = await emailMyResetLink();
                if (result?.sent) {
                  setLinkSent(true);
                  setLinkMsg("Sent. Check your email for the link.");
                } else {
                  setLinkMsg(result?.error ?? "Something went wrong.");
                }
              } finally {
                setBusy(false);
              }
            }}
            className="underline underline-offset-4 hover:text-black disabled:opacity-50 dark:hover:text-white"
          >
            Email me a reset link
          </button>
        </p>
        {linkMsg && (
          <p role="status" className="mt-2 text-sm text-black/60 dark:text-white/60">
            {linkMsg}
          </p>
        )}
      </form>
    </div>
  );
}
