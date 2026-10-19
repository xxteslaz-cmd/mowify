"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { DayForecast } from "@/lib/weather";
import { formatDisplayDate, parseISODate, todayISO } from "@/lib/date";
import { pushRainDay, type RainDayResult } from "./actions";

/**
 * Rain-day control: a banner when the forecast says rain, otherwise a plain
 * "Rain day" button so the owner can still call it when the forecast is wrong.
 * Either way it moves the day's remaining jobs and shows what moved.
 */
export default function RainDay({
  dateISO,
  forecast,
  hasLocation,
  remaining,
}: {
  dateISO: string;
  forecast: DayForecast | null;
  hasLocation: boolean;
  remaining: number;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<RainDayResult | null>(null);
  const dayWord = dateISO === todayISO() ? "today's" : "this day's";

  async function push() {
    setPending(true);
    const res = await pushRainDay(dateISO).catch(() => ({ error: "Something went wrong." }));
    setPending(false);
    setResult(res);
    router.refresh();
  }

  if (result) {
    if ("error" in result) {
      return (
        <div className="mb-4 card flex items-center justify-between gap-3 p-4 text-sm">
          <span className="text-danger">{result.error}</span>
          <button onClick={() => setResult(null)} className="btn btn-secondary">
            Close
          </button>
        </div>
      );
    }
    const byCrew = new Map<string, string[]>();
    for (const m of result.moved) byCrew.set(m.crew, [...(byCrew.get(m.crew) ?? []), m.customer]);
    return (
      <div className="mb-4 card border-brand p-4">
        <p className="font-semibold">
          {`Moved ${result.moved.length} job${result.moved.length === 1 ? "" : "s"} to ${formatDisplayDate(parseISODate(result.toISO))}.`}
        </p>
        <p className="text-sm text-muted">Crew phones already show the new routes.</p>
        <ul className="mt-2 space-y-1 text-sm">
          {[...byCrew].map(([crew, customers]) => (
            <li key={crew}>
              <span className="font-medium">{crew}:</span> {customers.join(", ")}
            </li>
          ))}
        </ul>
        <div className="mt-3 flex gap-2">
          <Link href={`/dashboard?date=${result.toISO}`} className="btn btn-primary">
            View that day
          </Link>
          <button onClick={() => setResult(null)} className="btn btn-secondary">
            Close
          </button>
        </div>
        {!hasLocation && (
          <p className="mt-3 text-xs text-muted">
            Add your ZIP in <Link href="/settings" className="underline">Settings</Link> to get rain alerts here
            automatically.
          </p>
        )}
      </div>
    );
  }

  if (remaining === 0) return null;

  if (forecast?.rainy) {
    return (
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border-2 border-blue-500 bg-blue-50 p-4 text-blue-950 dark:bg-blue-950/40 dark:text-blue-100">
        <div>
          <p className="text-lg font-semibold">🌧 Rain forecast</p>
          <p className="text-sm">
            {[
              forecast.probability !== null && `${forecast.probability}% chance`,
              forecast.mm !== null && `${forecast.mm} mm expected`,
            ]
              .filter(Boolean)
              .join(" · ")}
            {` · ${remaining} job${remaining === 1 ? "" : "s"} still scheduled`}
          </p>
        </div>
        <button onClick={push} disabled={pending} className="btn btn-primary btn-lg">
          {pending ? "Moving..." : `Push ${dayWord} jobs`}
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => {
        if (confirm(`Move ${dayWord} ${remaining} remaining job${remaining === 1 ? "" : "s"} to the next working day?`))
          push();
      }}
      disabled={pending}
      className="mb-4 btn btn-secondary"
    >
      {pending ? "Moving..." : "🌧 Rain day"}
    </button>
  );
}
