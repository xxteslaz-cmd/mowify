"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { changePassword, resendVerification } from "./actions";

const FIELD =
  "w-full rounded-md border border-black/10 px-3 py-2 text-sm dark:border-white/10 dark:bg-transparent";

export default function AccountClient({
  email,
  verified,
}: {
  email: string;
  verified: boolean;
}) {
  const router = useRouter();
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

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
          <p className="text-sm text-black/60 dark:text-white/60">
            Confirmed.
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

      <form
        onSubmit={submit}
        className="rounded-lg border border-black/10 p-4 dark:border-white/10"
      >
        <p className="mb-3 text-sm font-medium">Change password</p>

        <div className="space-y-3">
          <input
            type="password"
            placeholder="Current password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrent(e.target.value)}
            required
            className={FIELD}
          />
          <input
            type="password"
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
      </form>
    </div>
  );
}
