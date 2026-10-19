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
    <div className={`card p-4 ${isDone ? "border-brand" : ""}`}>
      <div className="flex items-start gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg font-bold ${isDone ? "bg-brand text-on-brand" : "bg-border"}`}>
          {isDone ? "✓" : stopNumber}
        </span>
        <div className="min-w-0 flex-1">
          <p className={`text-xl font-bold ${isDone ? "line-through" : ""}`}>{job.customer.name}</p>
          <p className="mt-1 text-lg">{job.customer.address}</p>
          {job.customer.phone && (
            <a href={`tel:${job.customer.phone}`} className="block py-2 text-lg font-semibold text-brand underline">
              {job.customer.phone}
            </a>
          )}
          <p className="mt-1 text-base font-medium">{serviceLabel(job)}</p>
          {job.customer.notes && (
            <p className="mt-1 rounded bg-amber-50 p-2 text-base text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
              {job.customer.notes}
            </p>
          )}
          {job.notes && <p className="mt-1 text-base italic">{job.notes}</p>}
        </div>
      </div>

      <a
        href={mapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="btn btn-secondary btn-lg mt-3 w-full"
      >
        Open in Maps
      </a>

      <div className="mt-2 flex gap-2">
        <button
          onClick={() => setStatus("COMPLETED")}
          disabled={pending || job.status === "COMPLETED"}
          className="btn btn-primary btn-lg min-h-14 flex-1 text-lg"
        >
          {isDone ? "Done ✓" : "Mark done"}
        </button>
        <button
          onClick={() => setStatus("SKIPPED")}
          disabled={pending || job.status === "SKIPPED"}
          className="btn btn-secondary btn-lg min-h-14"
        >
          Skip
        </button>
      </div>
    </div>
  );
}
