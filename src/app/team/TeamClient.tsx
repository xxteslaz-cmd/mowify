"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Crew } from "@prisma/client";
import {
  createCrewLogin,
  resetCrewPin,
  setCrewLoginActive,
} from "./actions";

type Member = {
  id: string;
  name: string;
  username: string | null;
  active: boolean;
  locked: boolean;
  crew: { id: string; name: string; color: string } | null;
};

const FIELD = "field";

export default function TeamClient({
  members,
  crews,
  crewLoginPath,
}: {
  members: Member[];
  crews: Crew[];
  crewLoginPath: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [crewId, setCrewId] = useState(crews[0]?.id ?? "");

  // Built in the browser so the link the owner copies is the one their crew
  // will actually open, whatever host the app is served from.
  const fullLink =
    typeof window === "undefined"
      ? crewLoginPath
      : `${window.location.origin}${crewLoginPath}`;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    await run(async () => {
      await createCrewLogin({ name, username, pin, crewId });
      setName("");
      setUsername("");
      setPin("");
    });
  }

  async function handleResetPin(id: string) {
    const next = window.prompt("New 6-digit PIN:");
    if (!next) return;
    await run(() => resetCrewPin(id, next));
  }

  return (
    <div className="px-4 py-6 md:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Team</h1>
        <p className="mt-1 text-sm text-muted">
          Logins for your crew. Each person sees only their own day.
        </p>
      </div>

      {/* Crew logins and the add-login form read as forms, not a dashboard,
          so they keep a reading width instead of stretching with the page. */}
      <div className="max-w-3xl">
        <div className="mb-6 card p-4">
          <p className="mb-2 text-sm font-medium">Crew sign-in link</p>
          <p className="mb-3 text-sm text-muted">
            Text this to your crew once. They bookmark it and sign in with their
            username and PIN.
          </p>
          <div className="flex gap-2">
            <input readOnly value={fullLink} className={`${FIELD} font-mono`} />
            <button
              onClick={() => {
                navigator.clipboard.writeText(fullLink);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="shrink-0 btn btn-primary"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>

        {error && (
          <p role="alert" className="mb-4 card border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {error}
          </p>
        )}

        <div className="mb-6 divide-y divide-border card">
          {members.length === 0 && (
            <p className="p-4 text-sm text-muted">
              No crew logins yet.
            </p>
          )}
          {members.map((m) => {
            return (
              <div
                key={m.id}
                className="flex items-center justify-between gap-3 p-4"
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {m.name}
                    {!m.active && (
                      <span className="ml-2 text-xs text-muted">
                        deactivated
                      </span>
                    )}
                    {m.locked && (
                      <span className="ml-2 text-xs text-amber-600 dark:text-amber-400">
                        locked out
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-muted">
                    <span className="font-mono">{m.username}</span>
                    {m.crew && (
                      <>
                        {" · "}
                        <span
                          className="inline-block h-2 w-2 rounded-full align-middle"
                          style={{ backgroundColor: m.crew.color }}
                        />{" "}
                        {m.crew.name}
                      </>
                    )}
                  </p>
                </div>

                <div className="flex shrink-0 gap-3 text-sm">
                  <button
                    disabled={busy}
                    onClick={() => handleResetPin(m.id)}
                    className="btn btn-ghost"
                  >
                    Reset PIN
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => run(() => setCrewLoginActive(m.id, !m.active))}
                    className="btn btn-ghost"
                  >
                    {m.active ? "Deactivate" : "Reactivate"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <form onSubmit={handleAdd} className="card p-4">
          <p className="mb-3 text-sm font-medium">Add a crew login</p>

          <div className="grid gap-3 sm:grid-cols-2">
            <input
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className={FIELD}
            />
            <input
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoCapitalize="none"
              required
              className={FIELD}
            />
            <input
              placeholder="6-digit PIN"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              required
              className={FIELD}
            />
            <select
              value={crewId}
              onChange={(e) => setCrewId(e.target.value)}
              required
              className={FIELD}
            >
              {crews.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            disabled={busy || crews.length === 0}
            className="mt-3 btn btn-primary"
          >
            Add crew login
          </button>

          {crews.length === 0 && (
            <p className="mt-2 text-sm text-muted">
              Create a crew on the dashboard first.
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
