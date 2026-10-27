import { addDays } from "./date";

/**
 * Rain forecasts for the dashboard banner. Two free, keyless services:
 * zippopotam.us turns a US ZIP into coordinates once (saved on Org), and
 * Open-Meteo gives the daily forecast. Every failure returns null — a weather
 * outage must never break the dashboard, it just hides the banner.
 */

// ponytail: one fixed threshold for every company; make it a setting if owners ask.
export const RAIN_PROBABILITY = 60; // percent
export const RAIN_MM = 5; // daily total

export function isRainy(probability: number | null, mm: number | null): boolean {
  return (probability ?? 0) >= RAIN_PROBABILITY || (mm ?? 0) >= RAIN_MM;
}

/** The next Monday–Saturday after `date` (UTC midnight). Sundays are skipped. */
export function nextWorkday(date: Date): Date {
  const next = addDays(date, 1);
  return next.getUTCDay() === 0 ? addDays(next, 1) : next;
}

export async function lookupZip(
  zip: string,
): Promise<{ lat: number; lon: number; place: string } | null> {
  try {
    const res = await fetch(`https://api.zippopotam.us/us/${encodeURIComponent(zip)}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const body = await res.json();
    const p = body.places?.[0];
    if (!p) return null;
    return {
      lat: Number(p.latitude),
      lon: Number(p.longitude),
      place: `${p["place name"]}, ${p["state abbreviation"]}`,
    };
  } catch {
    return null;
  }
}

export type DayForecast = { probability: number | null; mm: number | null; rainy: boolean };

/** Forecast for one calendar day at a location, or null if unavailable. */
export async function getDayForecast(
  lat: number,
  lon: number,
  dateISO: string,
): Promise<DayForecast | null> {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&daily=precipitation_probability_max,precipitation_sum&timezone=auto` +
      `&start_date=${dateISO}&end_date=${dateISO}`;
    // An hour is plenty fresh for a daily forecast, and the dashboard polls.
    const res = await fetch(url, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const { daily } = await res.json();
    const probability = daily?.precipitation_probability_max?.[0] ?? null;
    const mm = daily?.precipitation_sum?.[0] ?? null;
    return { probability, mm, rainy: isRainy(probability, mm) };
  } catch {
    return null;
  }
}

/**
 * The days from `fromISO` to `toISO` (inclusive) whose forecast is rainy, for
 * the raindrops on the dashboard calendar. One request for the whole range.
 * Open-Meteo forecasts 16 days ahead, so the caller clips the range to that.
 * Any failure returns no days, the same as no rain.
 */
export async function getRainyDays(
  lat: number,
  lon: number,
  fromISO: string,
  toISO: string,
): Promise<string[]> {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&daily=precipitation_probability_max,precipitation_sum&timezone=auto` +
      `&start_date=${fromISO}&end_date=${toISO}`;
    const res = await fetch(url, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const { daily } = await res.json();
    const days: string[] = daily?.time ?? [];
    return days.filter((_, i) =>
      isRainy(
        daily.precipitation_probability_max?.[i] ?? null,
        daily.precipitation_sum?.[i] ?? null,
      ),
    );
  } catch {
    return [];
  }
}
