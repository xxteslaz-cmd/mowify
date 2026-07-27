"use client";

import type { Frequency } from "@prisma/client";
import type { JobWithNextDate } from "@/lib/types";

const SERVICE_LABEL: Record<string, string> = {
  MOW: "Mow",
  MULCH: "Mulch",
  CLEANUP: "Cleanup",
  ONE_TIME: "One-time",
  OTHER: "Other",
};

const FREQUENCIES: Frequency[] = ["ONE_TIME", "WEEKLY", "BIWEEKLY", "MONTHLY"];

const FREQUENCY_LABEL: Record<Frequency, string> = {
  ONE_TIME: "One-time",
  WEEKLY: "Weekly",
  BIWEEKLY: "Biweekly",
  MONTHLY: "Monthly",
};

const STATUS_STYLE: Record<string, string> = {
  SCHEDULED: "",
  COMPLETED: "opacity-60 line-through decoration-black/40",
  SKIPPED: "opacity-50",
  RESCHEDULED: "",
};

const STATUS_BADGE: Record<string, string> = {
  COMPLETED: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  SKIPPED: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  RESCHEDULED: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
};

export default function JobCard({
  job,
  crewColor,
  selectMode,
  selected,
  onToggleSelect,
  onDelete,
  onFrequencyChange,
  onDragStart,
  onDragOverCard,
  isDragOver,
}: {
  job: JobWithNextDate;
  crewColor?: string;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onDelete: () => void;
  onFrequencyChange: (frequency: Frequency) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOverCard: (e: React.DragEvent) => void;
  isDragOver: boolean;
}) {
  const movable = job.status === "SCHEDULED" || job.status === "RESCHEDULED";
  const editableFrequency = movable;
  return (
    <div
      draggable={!selectMode}
      onDragStart={onDragStart}
      onDragOver={onDragOverCard}
      className={`group rounded-lg border bg-white p-3 shadow-sm dark:bg-zinc-900 ${
        isDragOver ? "border-blue-400 ring-2 ring-blue-300" : "border-black/10 dark:border-white/10"
      } ${STATUS_STYLE[job.status]} ${selectMode ? "" : "cursor-grab active:cursor-grabbing"}`}
      style={crewColor ? { borderLeftColor: crewColor, borderLeftWidth: 4 } : undefined}
    >
      <div className="flex items-start gap-2">
        {selectMode && (
          <input
            type="checkbox"
            checked={selected}
            disabled={!movable}
            onChange={onToggleSelect}
            title={movable ? undefined : "Completed or skipped jobs can't be rescheduled"}
            className="mt-1 h-4 w-4 disabled:opacity-30"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-medium">{job.customer.name}</p>
            {job.status !== "SCHEDULED" && (
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_BADGE[job.status] ?? ""}`}>
                {job.status}
              </span>
            )}
          </div>
          <p className="truncate text-xs text-black/60 dark:text-white/60">{job.customer.address}</p>
          <div className="mt-1 flex items-center gap-2 text-xs text-black/70 dark:text-white/70">
            <span>{SERVICE_LABEL[job.serviceType]}</span>
            {editableFrequency && !selectMode ? (
              <select
                value={job.frequency}
                onChange={(e) => onFrequencyChange(e.target.value as Frequency)}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                aria-label="Frequency"
                className="rounded bg-black/5 px-1 py-0.5 text-xs dark:bg-white/10"
              >
                {FREQUENCIES.map((f) => (
                  <option key={f} value={f}>
                    {FREQUENCY_LABEL[f]}
                  </option>
                ))}
              </select>
            ) : (
              job.frequency !== "ONE_TIME" && (
                <span className="rounded bg-black/5 px-1.5 py-0.5 dark:bg-white/10">{FREQUENCY_LABEL[job.frequency]}</span>
              )
            )}
          </div>
          {job.frequency !== "ONE_TIME" && job.nextDate && (
            <p className="mt-0.5 text-xs text-black/50 dark:text-white/50">
              Next: {job.nextDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </p>
          )}
          {job.notes && (
            <p className="mt-1 truncate text-xs italic text-black/50 dark:text-white/50">{job.notes}</p>
          )}
        </div>
        {!selectMode && (
          <button
            onClick={onDelete}
            aria-label="Delete job"
            className="shrink-0 rounded px-1 text-black/30 opacity-0 hover:bg-black/5 hover:text-black/70 group-hover:opacity-100 dark:text-white/30 dark:hover:bg-white/10 dark:hover:text-white/70"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}
