import { getActiveCrews, getAllCrews, getDaySummaries, getJobsForDate } from "@/lib/data";
import { prisma } from "@/lib/prisma";
import { monthGridDays, parseISODate, todayISO } from "@/lib/date";
import { attachNextDates, ensureOccurrencesThrough, horizonDate } from "@/lib/recurring";
import CalendarNav from "./CalendarNav";
import DashboardBoard from "./DashboardBoard";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; month?: string }>;
}) {
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
    lastVisible.getTime() > target.getTime() ? lastVisible : target,
  );

  const [crews, allCrews, jobs, customers, summaries] = await Promise.all([
    getActiveCrews(),
    getAllCrews(),
    getJobsForDate(dateISO),
    prisma.customer.findMany({ orderBy: { name: "asc" } }),
    getDaySummaries(gridDays),
  ]);
  const jobsWithNextDate = await attachNextDates(jobs);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <CalendarNav dateISO={dateISO} monthISO={monthISO} summaries={summaries} />
      <DashboardBoard
        key={dateISO}
        dateISO={dateISO}
        crews={crews}
        allCrews={allCrews}
        jobs={jobsWithNextDate}
        customers={customers}
      />
    </div>
  );
}
