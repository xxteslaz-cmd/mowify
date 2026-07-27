"use client";

import { useRouter } from "next/navigation";
import { addDays, parseISODate, toISODate, todayISO, formatDisplayDate } from "@/lib/date";

export default function DateNav({ dateISO }: { dateISO: string }) {
  const router = useRouter();

  function goTo(next: string) {
    router.push(`/dashboard?date=${next}`);
  }

  const date = parseISODate(dateISO);

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{formatDisplayDate(date)}</h1>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => goTo(toISODate(addDays(date, -1)))}
          className="rounded-md border border-black/10 px-3 py-1.5 text-sm hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
          aria-label="Previous day"
        >
          ←
        </button>
        <button
          onClick={() => goTo(todayISO())}
          className="rounded-md border border-black/10 px-3 py-1.5 text-sm hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
        >
          Today
        </button>
        <button
          onClick={() => goTo(toISODate(addDays(date, 1)))}
          className="rounded-md border border-black/10 px-3 py-1.5 text-sm hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
          aria-label="Next day"
        >
          →
        </button>
        <input
          type="date"
          value={dateISO}
          onChange={(e) => e.target.value && goTo(e.target.value)}
          className="rounded-md border border-black/10 px-2 py-1.5 text-sm dark:border-white/10 dark:bg-transparent"
        />
      </div>
    </div>
  );
}
