"use client";

import { useState } from "react";
import type { Crew } from "@prisma/client";
import type { JobWithNextDate } from "@/lib/types";
import { toISODate } from "@/lib/date";
import { serviceLabel, FREQUENCY_LABEL } from "@/lib/labels";
import { updateJob } from "./actions";

export default function EditJobModal({
  job,
  crews,
  onClose,
  onSaved,
}: {
  job: JobWithNextDate;
  crews: Crew[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [date, setDate] = useState(toISODate(job.scheduledDate));
  const [crewId, setCrewId] = useState(job.crewId);
  const [notes, setNotes] = useState(job.notes ?? "");
  const [scope, setScope] = useState<"this" | "future">("this");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A one-off visit has nothing to cascade onto, so the choice is meaningless.
  const isSeries = Boolean(job.seriesId) && job.frequency !== "ONE_TIME";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!crewId) {
      setError("Select a crew.");
      return;
    }
    setSubmitting(true);
    try {
      await updateJob({
        jobId: job.id,
        dateISO: date,
        crewId,
        notes: notes.trim() || null,
        scope: isSeries ? scope : "this",
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-5 shadow-xl dark:bg-zinc-900"
      >
        <h2 className="text-lg font-semibold">Edit Job</h2>
        <p className="mb-4 text-sm text-black/60 dark:text-white/60">
          {job.customer.name} — {serviceLabel(job)}
          {job.frequency !== "ONE_TIME" && ` · ${FREQUENCY_LABEL[job.frequency]}`}
        </p>

        <div className="mb-4 grid grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-black/60 dark:text-white/60">Date</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-md border border-black/10 px-2 py-2 text-sm dark:border-white/10 dark:bg-transparent"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-black/60 dark:text-white/60">Crew</span>
            <select
              value={crewId}
              onChange={(e) => setCrewId(e.target.value)}
              className="w-full rounded-md border border-black/10 px-2 py-2 text-sm dark:border-white/10 dark:bg-transparent"
            >
              {crews.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="mb-4 block text-sm">
          <span className="mb-1 block text-black/60 dark:text-white/60">Notes for this visit</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="e.g. skip the back gate, bill on completion"
            className="w-full rounded-md border border-black/10 px-3 py-2 text-sm dark:border-white/10 dark:bg-transparent"
          />
        </label>

        {isSeries && (
          <fieldset className="mb-4 rounded-md bg-black/5 p-3 dark:bg-white/10">
            <legend className="px-1 text-xs font-medium text-black/60 dark:text-white/60">
              Apply to
            </legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="scope"
                checked={scope === "this"}
                onChange={() => setScope("this")}
                className="h-4 w-4"
              />
              This visit only
            </label>
            <label className="mt-1 flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="scope"
                checked={scope === "future"}
                onChange={() => setScope("future")}
                className="h-4 w-4"
              />
              This and all future visits
            </label>
            <p className="mt-2 text-xs text-black/50 dark:text-white/50">
              Completed and skipped visits are never changed. Moving the date shifts later
              visits by the same number of days.
            </p>
          </fieldset>
        )}

        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-black/10 px-3 py-2 text-sm dark:border-white/10"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
          >
            {submitting ? "Saving..." : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
