"use client";

import { useRouter } from "next/navigation";
import type { DaySummary } from "@/lib/data";
import {
  addMonths,
  formatDisplayDate,
  formatMonthLabel,
  monthGridDays,
  parseISODate,
  toISODate,
  todayISO,
} from "@/lib/date";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Crew colours shown per day before collapsing into a "+n" count. */
const MAX_DOTS = 3;

export default function CalendarNav({
  dateISO,
  monthISO,
  summaries,
  rainyDays,
}: {
  dateISO: string;
  monthISO: string;
  summaries: Record<string, DaySummary>;
  /** Days the forecast calls rainy, marked with a raindrop. */
  rainyDays: string[];
}) {
  const router = useRouter();

  const selected = parseISODate(dateISO);
  const monthAnchor = parseISODate(`${monthISO}-01`);
  const today = todayISO();
  const days = monthGridDays(monthAnchor);
  const rainy = new Set(rainyDays);

  // Selecting a day drops the month param so the grid follows the selection;
  // paging months keeps the selected day put.
  function selectDay(iso: string) {
    router.push(`/dashboard?date=${iso}`);
  }
  function goMonth(delta: number) {
    const next = addMonths(monthAnchor, delta);
    router.push(`/dashboard?date=${dateISO}&month=${toISODate(next).slice(0, 7)}`);
  }

  return (
    <div className="mb-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{formatDisplayDate(selected)}</h1>
        <button onClick={() => selectDay(today)} className="btn btn-secondary">
          Go to today
        </button>
      </div>

      <div className="card p-2">
        <div className="mb-1 flex items-center justify-between px-1">
          <button
            onClick={() => goMonth(-1)}
            className="tap-target min-w-11 justify-center rounded text-sm hover:bg-foreground/5"
            aria-label="Previous month"
          >
            ←
          </button>
          <h2 className="text-sm font-semibold">{formatMonthLabel(monthAnchor)}</h2>
          <button
            onClick={() => goMonth(1)}
            className="tap-target min-w-11 justify-center rounded text-sm hover:bg-foreground/5"
            aria-label="Next month"
          >
            →
          </button>
        </div>

        <div className="grid grid-cols-7 gap-0.5">
          {WEEKDAYS.map((w) => (
            <div
              key={w}
              className="text-center text-[10px] font-medium text-muted"
            >
              {w}
            </div>
          ))}

          {days.map((day) => {
            const iso = toISODate(day);
            const summary = summaries[iso];
            const inMonth = day.getUTCMonth() === monthAnchor.getUTCMonth();
            const isSelected = iso === dateISO;
            const isToday = iso === today;
            const extra = summary ? summary.colors.length - MAX_DOTS : 0;
            const isRainy = rainy.has(iso);

            return (
              <button
                key={iso}
                onClick={() => selectDay(iso)}
                aria-current={isSelected ? "date" : undefined}
                title={
                  summary
                    ? `${summary.count} job${summary.count === 1 ? "" : "s"}`
                    : "No jobs"
                }
                aria-label={`${formatDisplayDate(day)}${
                  summary ? `, ${summary.count} job${summary.count === 1 ? "" : "s"}` : ", no jobs"
                }${isRainy ? ", rain forecast" : ""}`}
                className={`relative flex min-h-[42px] flex-col items-center justify-start gap-0.5 rounded-md border px-0.5 py-1 transition ${
                  isSelected
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30"
                    : "border-transparent hover:bg-foreground/[.05]"
                } ${inMonth ? "" : "opacity-35"}`}
              >
                {isRainy && (
                  <svg
                    aria-hidden
                    viewBox="0 0 10 14"
                    className="absolute right-1 top-1 h-2.5 w-2 text-sky-500"
                  >
                    <path
                      fill="currentColor"
                      d="M5 0C5 0 0 6.2 0 9a5 5 0 0 0 10 0C10 6.2 5 0 5 0Z"
                    />
                  </svg>
                )}

                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] leading-none ${
                    isToday
                      ? "bg-brand font-semibold text-on-brand"
                      : "font-medium"
                  }`}
                >
                  {day.getUTCDate()}
                </span>

                {summary && (
                  <span className="flex items-center gap-0.5">
                    {summary.colors.slice(0, MAX_DOTS).map((c) => (
                      <span
                        key={c}
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: c }}
                      />
                    ))}
                    {extra > 0 && (
                      <span className="text-[9px] leading-none text-muted">
                        +{extra}
                      </span>
                    )}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
