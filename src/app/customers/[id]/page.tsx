import { notFound } from "next/navigation";
import { getCustomerWithJobs } from "@/lib/data";
import { todayISO } from "@/lib/date";
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
    .filter((j) => j.scheduledDate.toISOString().slice(0, 10) >= today)
    .sort((a, b) => a.scheduledDate.getTime() - b.scheduledDate.getTime());
  const history = customer.jobs
    .filter((j) => j.scheduledDate.toISOString().slice(0, 10) < today)
    .sort((a, b) => b.scheduledDate.getTime() - a.scheduledDate.getTime());

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <CustomerDetailClient customer={customer} upcoming={upcoming} history={history} />
    </div>
  );
}
