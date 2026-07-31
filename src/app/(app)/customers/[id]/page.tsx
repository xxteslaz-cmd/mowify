import { notFound } from "next/navigation";
import { getCustomerWithJobs } from "@/lib/data";
import { toISODate, todayISO } from "@/lib/date";
import CustomerDetailClient from "./CustomerDetailClient";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const customer = await getCustomerWithJobs(id);
  if (!customer) notFound();

  const today = todayISO();
  const upcoming = customer.jobs
    .filter((j) => toISODate(j.scheduledDate) >= today)
    .sort((a, b) => a.scheduledDate.getTime() - b.scheduledDate.getTime());
  const history = customer.jobs
    .filter((j) => toISODate(j.scheduledDate) < today)
    .sort((a, b) => b.scheduledDate.getTime() - a.scheduledDate.getTime());

  return (
    <div className="px-4 py-6 md:px-8">
      <CustomerDetailClient customer={customer} upcoming={upcoming} history={history} />
    </div>
  );
}
