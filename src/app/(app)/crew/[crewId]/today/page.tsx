import { notFound } from "next/navigation";
import { getCrewTodayJobs } from "@/lib/data";
import { todayISO, formatDisplayDate, parseISODate } from "@/lib/date";
import AutoRefresh from "@/components/AutoRefresh";
import StopCard from "./StopCard";

export default async function CrewTodayPage({
  params,
  searchParams,
}: {
  params: Promise<{ crewId: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const { crewId } = await params;
  const { date: dateParam } = await searchParams;
  const dateISO = dateParam ?? todayISO();

  const { crew, jobs } = await getCrewTodayJobs(crewId, dateISO);
  if (!crew) notFound();

  return (
    <div className="mx-auto max-w-lg px-3 py-4">
      <AutoRefresh />
      <div className="mb-4 flex items-center gap-2">
        <span className="h-4 w-4 rounded-full" style={{ backgroundColor: crew.color }} />
        <div>
          <h1 className="text-lg font-semibold leading-tight">{crew.name}</h1>
          <p className="text-sm text-muted">{formatDisplayDate(parseISODate(dateISO))}</p>
        </div>
      </div>

      {jobs.length === 0 ? (
        <p className="card p-6 text-center text-sm text-muted">
          No stops scheduled.
        </p>
      ) : (
        <div className="space-y-3">
          {jobs.map((job, i) => (
            <StopCard key={job.id} job={job} stopNumber={i + 1} dateISO={dateISO} crewId={crewId} />
          ))}
        </div>
      )}
    </div>
  );
}
