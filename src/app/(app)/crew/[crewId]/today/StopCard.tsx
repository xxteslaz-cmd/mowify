"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { JobWithCustomer } from "@/lib/types";
import { updateJobStatus } from "@/app/(app)/dashboard/actions";
import { serviceLabel } from "@/lib/labels";

export default function StopCard({
  job,
  stopNumber,
}: {
  job: JobWithCustomer;
  stopNumber: number;
  dateISO: string;
  crewId: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const isDone = job.status === "COMPLETED";

  async function setStatus(status: "COMPLETED" | "SKIPPED") {
    setPending(true);
    await updateJobStatus(job.id, status);
    router.refresh();
    setPending(false);
  }

  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.customer.address)}`;

  return (
    <div className={`card p-4 ${isDone ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-border text-sm font-semibold">
          {stopNumber}
        </span>
        <div className="min-w-0 flex-1">
          <p className={`text-base font-semibold ${isDone ? "line-through" : ""}`}>{job.customer.name}</p>
          <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="block truncate text-sm text-blue-600 underline dark:text-blue-400">
            {job.customer.address}
          </a>
          {job.customer.phone && (
            <a href={`tel:${job.customer.phone}`} className="block text-sm text-blue-600 underline dark:text-blue-400">
              {job.customer.phone}
            </a>
          )}
          <p className="mt-1 text-sm text-muted">{serviceLabel(job)}</p>
          {job.customer.notes && (
            <p className="mt-1 rounded bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
              {job.customer.notes}
            </p>
          )}
          {job.notes && <p className="mt-1 text-sm italic text-muted">{job.notes}</p>}
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <button
          onClick={() => setStatus("COMPLETED")}
          disabled={pending || job.status === "COMPLETED"}
          className="btn btn-primary btn-lg flex-1"
        >
          {isDone ? "Completed ✓" : "Mark Complete"}
        </button>
        <button
          onClick={() => setStatus("SKIPPED")}
          disabled={pending || job.status === "SKIPPED"}
          className="btn btn-secondary btn-lg"
        >
          Skip
        </button>
      </div>
    </div>
  );
}
