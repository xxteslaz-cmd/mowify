import type { Metadata } from "next";
import {
  getActiveCrews,
  getAllCrews,
  getAssigneeMode,
  getCustomers,
  getDaySummaries,
  getJobsForDate,
  getSetupProgress,
  getWeatherLocation,
} from "@/lib/data";
import { getDayForecast, getRainyDays } from "@/lib/weather";
import { assigneeTerms } from "@/lib/assignee-terms";
import { requireOwner } from "@/lib/auth/dal";
import { addDays, monthGridDays, parseISODate, toISODate, todayISO } from "@/lib/date";
import { attachNextDates, ensureOccurrencesThrough, horizonDate } from "@/lib/recurring";
import CalendarNav from "./CalendarNav";
import DashboardBoard from "./DashboardBoard";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; month?: string }>;
}) {
  // Cached alongside the identical check each data.ts function below performs,
  // so this costs no extra query — it just gets orgId into this scope so the
  // recurring-job writer can be scoped to this company alone.
  const { orgId } = await requireOwner();

  const params = await searchParams;
  const dateISO = params.date ?? todayISO();
  const monthISO = params.month ?? dateISO.slice(0, 7);

  const gridDays = monthGridDays(parseISODate(`${monthISO}-01`));

  // Recurring visits are real rows, so they must exist before anything queries
  // them. Cover the standard horizon plus whatever the calendar is showing, so
  // paging into a future month fills that month in. A no-op once caught up.
  const lastVisible = gridDays[gridDays.length - 1];
  const target = horizonDate();
  await ensureOccurrencesThrough(
    orgId,
    lastVisible.getTime() > target.getTime() ? lastVisible : target,
  );

  // In the same Promise.all rather than a serial await: the mode is one small
  // read, and awaiting it on its own line would add a round trip to every
  // dashboard render.
  const [crews, allCrews, jobs, customers, summaries, assigneeMode, setup, weather] =
    await Promise.all([
      getActiveCrews(),
      getAllCrews(),
      getJobsForDate(dateISO),
      getCustomers(),
      getDaySummaries(gridDays),
      getAssigneeMode(),
      getSetupProgress(),
      getWeatherLocation(),
    ]);
  const terms = assigneeTerms(assigneeMode);
  // Open-Meteo forecasts about two weeks out; past days have nothing to push.
  const daysAhead = (parseISODate(dateISO).getTime() - parseISODate(todayISO()).getTime()) / 86_400_000;
  // Raindrops on the calendar: the visible days from today up to the 16-day
  // forecast limit.
  const rainFrom = [todayISO(), toISODate(gridDays[0])].sort()[1];
  const rainTo = [toISODate(addDays(parseISODate(todayISO()), 15)), toISODate(lastVisible)].sort()[0];
  const [jobsWithNextDate, forecast, rainyDays] = await Promise.all([
    attachNextDates(orgId, jobs),
    weather.weatherLat !== null && weather.weatherLon !== null && daysAhead >= 0 && daysAhead <= 14
      ? getDayForecast(weather.weatherLat, weather.weatherLon, dateISO)
      : null,
    weather.weatherLat !== null && weather.weatherLon !== null && rainFrom <= rainTo
      ? getRainyDays(weather.weatherLat, weather.weatherLon, rainFrom, rainTo)
      : [],
  ]);

  return (
    <div className="px-4 py-6 md:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="mt-1 text-sm text-muted">
          {`Plan the day, move jobs between ${terms.many}, and see what's next.`}
        </p>
      </div>
      <CalendarNav dateISO={dateISO} monthISO={monthISO} summaries={summaries} rainyDays={rainyDays} />
      <DashboardBoard
        key={dateISO}
        dateISO={dateISO}
        crews={crews}
        allCrews={allCrews}
        jobs={jobsWithNextDate}
        customers={customers}
        terms={terms}
        setup={setup}
        forecast={forecast}
        hasLocation={weather.weatherLat !== null}
      />
    </div>
  );
}
