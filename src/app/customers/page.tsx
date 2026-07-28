import { getActiveCrews, getCustomersWithJobCounts } from "@/lib/data";
import CustomersClient from "./CustomersClient";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const [customers, crews] = await Promise.all([
    getCustomersWithJobCounts(),
    getActiveCrews(),
  ]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <h1 className="mb-4 text-xl font-semibold">Customers</h1>
      <CustomersClient customers={customers} crews={crews} />
    </div>
  );
}
