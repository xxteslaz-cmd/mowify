"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Crew } from "@prisma/client";
import type { AssigneeTerms } from "@/lib/assignee-terms";
import { generateFirstSchedule } from "./actions";

export type SetupProgress = { customers: number; crews: number; jobs: number; waiting: number };

/** Shown until the company has customers, a crew and a first job. */
export default function SetupChecklist({
  progress,
  crews,
  terms,
  onAddCrew,
  onAddJob,
}: {
  progress: SetupProgress;
  crews: Crew[];
  terms: AssigneeTerms;
  onAddCrew: () => void;
  onAddJob: () => void;
}) {
  const router = useRouter();
  const [crewId, setCrewId] = useState(crews[0]?.id ?? "");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const done = [progress.customers > 0, progress.crews > 0, progress.jobs > 0];
  if (done.every(Boolean)) return null;

  async function generate() {
    setPending(true);
    setMessage(null);
    const res = await generateFirstSchedule(crewId || crews[0]?.id).catch(() => ({
      error: "Something went wrong.",
    }));
    setPending(false);
    if ("error" in res) setMessage(res.error);
    else router.refresh();
  }

  const step = (i: number, title: string, body: React.ReactNode) => (
    <li className="flex gap-3">
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
          done[i] ? "bg-brand text-on-brand" : "bg-border"
        }`}
      >
        {done[i] ? "✓" : i + 1}
      </span>
      <div className="min-w-0 flex-1">
        <p className={`font-medium ${done[i] ? "text-muted line-through" : ""}`}>{title}</p>
        {!done[i] && <div className="mt-1 text-sm">{body}</div>}
      </div>
    </li>
  );

  return (
    <section className="mb-6 card p-5">
      <h2 className="text-lg font-semibold">Get set up</h2>
      <p className="text-sm text-muted">Three steps and your crews have their routes.</p>
      <ol className="mt-4 space-y-4">
        {step(
          0,
          "Import your customers",
          <Link href="/customers" className="btn btn-primary">
            Import a CSV
          </Link>,
        )}
        {step(
          1,
          `Add your ${terms.many}`,
          <button onClick={onAddCrew} className="btn btn-primary">
            {`Add a ${terms.one}`}
          </button>,
        )}
        {step(
          2,
          "Generate your first schedule",
          progress.waiting > 0 && crews.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span>{`Book ${progress.waiting} customer${progress.waiting === 1 ? "" : "s"} on their mow day for`}</span>
              {crews.length > 1 && (
                <select value={crewId} onChange={(e) => setCrewId(e.target.value)} className="field w-auto">
                  {crews.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
              {crews.length === 1 && <span className="font-medium">{crews[0].name}</span>}
              <button onClick={generate} disabled={pending} className="btn btn-primary">
                {pending ? "Scheduling..." : "Generate schedule"}
              </button>
              {message && <p className="w-full text-danger">{message}</p>}
            </div>
          ) : (
            <button onClick={onAddJob} disabled={crews.length === 0} className="btn btn-primary">
              Add your first job
            </button>
          ),
        )}
      </ol>
    </section>
  );
}
