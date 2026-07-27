"use client";

import { useRouter } from "next/navigation";
import type { DaySummary } from "@/lib/data";
import {
  addDays,
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
const MAX_DOTS = 4;

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
    <div className="mb-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{formatDisplayDate(selected)}</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => selectDay(toISODate(addDays(selected, -1)))}
            className="rounded-md border border-black/10 px-3 py-1.5 text-sm hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
            aria-label="Previous day"
          >
            ←
          </button>
          <button
            onClick={() => selectDay(today)}
            className="rounded-md border border-black/10 px-3 py-1.5 text-sm hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
          >
            Today
          </button>
          <button
            onClick={() => selectDay(toISODate(addDays(selected, 1)))}
            className="rounded-md border border-black/10 px-3 py-1.5 text-sm hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
            aria-label="Next day"
          >
            →
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-black/10 p-3 dark:border-white/10">
        <div className="mb-2 flex items-center justify-between px-1">
          <button
            onClick={() => goMonth(-1)}
            className="rounded-md px-2 py-1 text-sm hover:bg-black/5 dark:hover:bg-white/10"
            aria-label="Previous month"
          >
            ←
          </button>
          <h2 className="text-base font-semibold">{formatMonthLabel(monthAnchor)}</h2>
          <button
            onClick={() => goMonth(1)}
            className="rounded-md px-2 py-1 text-sm hover:bg-black/5 dark:hover:bg-white/10"
            aria-label="Next month"
          >
            →
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1">
          {WEEKDAYS.map((w) => (
            <div
              key={w}
              className="pb-1 text-center text-xs font-medium text-black/40 dark:text-white/40"
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
                aria-label={`${formatDisplayDate(day)}${
                  summary ? `, ${summary.count} job${summary.count === 1 ? "" : "s"}` : ", no jobs"
                }`}
                className={`flex min-h-[72px] flex-col items-start gap-1 rounded-lg border p-1.5 text-left transition ${
                  isSelected
                    ? "border-blue-500 bg-blue-50 ring-1 ring-blue-400 dark:bg-blue-900/30"
                    : "border-transparent hover:border-black/15 hover:bg-black/[.03] dark:hover:border-white/15 dark:hover:bg-white/[.05]"
                } ${inMonth ? "" : "opacity-35"}`}
              >
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-sm ${
                    isToday
                      ? "bg-black font-semibold text-white dark:bg-white dark:text-black"
                      : "font-medium"
                  }`}
                >
                  {day.getUTCDate()}
                </span>

                {summary && (
                  <span className="mt-auto flex w-full flex-wrap items-center gap-1">
                    {summary.colors.slice(0, MAX_DOTS).map((c) => (
                      <span
                        key={c}
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: c }}
                      />
                    ))}
                    {extra > 0 && (
                      <span className="text-[10px] leading-none text-black/50 dark:text-white/50">
                        +{extra}
                      </span>
                    )}
                    <span className="ml-auto text-[11px] font-medium tabular-nums text-black/55 dark:text-white/55">
                      {summary.count}
                    </span>
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
