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
}: {
  dateISO: string;
  monthISO: string;
  summaries: Record<string, DaySummary>;
}) {
  const router = useRouter();

  const selected = parseISODate(dateISO);
  const monthAnchor = parseISODate(`${monthISO}-01`);
  const today = todayISO();
  const days = monthGridDays(monthAnchor);

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
        <button
          onClick={() => selectDay(today)}
          className="rounded-md border border-black/10 px-3 py-1.5 text-sm hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
        >
          Go to today
        </button>
      </div>

      <div className="rounded-lg border border-black/10 p-2 dark:border-white/10">
        <div className="mb-1 flex items-center justify-between px-1">
          <button
            onClick={() => goMonth(-1)}
            className="rounded px-1.5 py-0.5 text-xs hover:bg-black/5 dark:hover:bg-white/10"
            aria-label="Previous month"
          >
            ←
          </button>
          <h2 className="text-sm font-semibold">{formatMonthLabel(monthAnchor)}</h2>
          <button
            onClick={() => goMonth(1)}
            className="rounded px-1.5 py-0.5 text-xs hover:bg-black/5 dark:hover:bg-white/10"
            aria-label="Next month"
          >
            →
          </button>
        </div>

        <div className="grid grid-cols-7 gap-0.5">
          {WEEKDAYS.map((w) => (
            <div
              key={w}
              className="text-center text-[10px] font-medium text-black/40 dark:text-white/40"
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
                }`}
                className={`flex min-h-[42px] flex-col items-center justify-start gap-0.5 rounded-md border px-0.5 py-1 transition ${
                  isSelected
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30"
                    : "border-transparent hover:bg-black/[.04] dark:hover:bg-white/[.06]"
                } ${inMonth ? "" : "opacity-35"}`}
              >
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] leading-none ${
                    isToday
                      ? "bg-black font-semibold text-white dark:bg-white dark:text-black"
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
                      <span className="text-[9px] leading-none text-black/50 dark:text-white/50">
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
