import { getActiveCrews, getJobsForDate } from "@/lib/data";
import { prisma } from "@/lib/prisma";
import { todayISO } from "@/lib/date";
import DateNav from "./DateNav";
import DashboardBoard from "./DashboardBoard";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const params = await searchParams;
  const dateISO = params.date ?? todayISO();

  const [crews, jobs, customers] = await Promise.all([
    getActiveCrews(),
    getJobsForDate(dateISO),
    prisma.customer.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <DateNav dateISO={dateISO} />
      <DashboardBoard
        key={dateISO}
        dateISO={dateISO}
        crews={crews}
        jobs={jobs}
        customers={customers}
      />
    </div>
  );
}
