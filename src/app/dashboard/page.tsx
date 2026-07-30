import { getActiveCrews, getAllCrews, getCustomers, getDaySummaries, getJobsForDate } from "@/lib/data";
import { requireOwner } from "@/lib/auth/dal";
import { monthGridDays, parseISODate, todayISO } from "@/lib/date";
import { attachNextDates, ensureOccurrencesThrough, horizonDate } from "@/lib/recurring";
import CalendarNav from "./CalendarNav";
import DashboardBoard from "./DashboardBoard";

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

  const [crews, allCrews, jobs, customers, summaries] = await Promise.all([
    getActiveCrews(),
    getAllCrews(),
    getJobsForDate(dateISO),
    getCustomers(),
    getDaySummaries(gridDays),
  ]);
  const jobsWithNextDate = await attachNextDates(orgId, jobs);

  return (
    <div className="px-4 py-6 md:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="mt-1 text-sm text-muted">
          Plan the day, move jobs between crews, and see what&apos;s next.
        </p>
      </div>
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
