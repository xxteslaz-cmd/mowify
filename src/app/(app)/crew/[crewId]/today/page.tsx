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
          <h1 className="text-2xl font-bold leading-tight">{crew.name}</h1>
          <p className="text-base font-medium">
            {formatDisplayDate(parseISODate(dateISO))}
            {jobs.length > 0 &&
              ` · ${jobs.filter((j) => j.status === "COMPLETED").length} of ${jobs.length} done`}
          </p>
        </div>
      </div>

      {jobs.length === 0 ? (
        <p className="card p-6 text-center text-lg">
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
