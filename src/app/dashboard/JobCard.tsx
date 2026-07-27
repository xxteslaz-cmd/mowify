"use client";

import type { Frequency } from "@prisma/client";
import type { JobWithNextDate } from "@/lib/types";
import { formatShortDate } from "@/lib/date";
import { FREQUENCIES, FREQUENCY_LABEL, serviceLabel } from "@/lib/labels";

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
  onEdit,
  onFrequencyChange,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: {
  job: JobWithNextDate;
  crewColor?: string;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onFrequencyChange: (frequency: Frequency) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const movable = job.status === "SCHEDULED" || job.status === "RESCHEDULED";
  const editableFrequency = movable;

  return (
    <div
      onClick={() => {
        if (selectMode) return;
        onEdit();
      }}
      title={selectMode ? undefined : "Click to edit"}
      className={`group rounded-lg border border-black/10 bg-white p-3 shadow-sm dark:border-white/10 dark:bg-zinc-900 ${
        STATUS_STYLE[job.status]
      } ${selectMode ? "" : "cursor-pointer hover:border-black/25 dark:hover:border-white/25"}`}
      style={crewColor ? { borderLeftColor: crewColor, borderLeftWidth: 4 } : undefined}
    >
      <div className="flex items-start gap-2">
        {selectMode && (
          <input
            type="checkbox"
            checked={selected}
            disabled={!movable}
            onClick={(e) => e.stopPropagation()}
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
            <span className="truncate">{serviceLabel(job)}</span>
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
              Next: {formatShortDate(job.nextDate)}
            </p>
          )}
          {job.notes && (
            <p className="mt-1 truncate text-xs italic text-black/50 dark:text-white/50">{job.notes}</p>
          )}
        </div>
        {!selectMode && (
          <div className="flex shrink-0 flex-col items-center opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onMoveUp();
              }}
              disabled={isFirst}
              aria-label="Move stop earlier"
              title="Move stop earlier"
              className="rounded px-1 text-xs leading-none text-black/35 hover:bg-black/5 hover:text-black/70 disabled:pointer-events-none disabled:opacity-20 dark:text-white/35 dark:hover:bg-white/10 dark:hover:text-white/70"
            >
              ▲
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onMoveDown();
              }}
              disabled={isLast}
              aria-label="Move stop later"
              title="Move stop later"
              className="rounded px-1 text-xs leading-none text-black/35 hover:bg-black/5 hover:text-black/70 disabled:pointer-events-none disabled:opacity-20 dark:text-white/35 dark:hover:bg-white/10 dark:hover:text-white/70"
            >
              ▼
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              aria-label="Delete job"
              className="rounded px-1 text-black/30 hover:bg-black/5 hover:text-black/70 dark:text-white/30 dark:hover:bg-white/10 dark:hover:text-white/70"
            >
              ×
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
