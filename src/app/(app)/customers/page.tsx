import {
  getActiveCrews,
  getAssigneeMode,
  getCustomersWithJobCounts,
} from "@/lib/data";
import { assigneeTerms } from "@/lib/assignee-terms";
import CustomersClient from "./CustomersClient";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const [customers, crews, assigneeMode] = await Promise.all([
    getCustomersWithJobCounts(),
    getActiveCrews(),
    getAssigneeMode(),
  ]);
  const terms = assigneeTerms(assigneeMode);

  return (
    <div className="px-4 py-6 md:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Customers</h1>
        <p className="mt-1 text-sm text-muted">
          Every customer on the books, and how many jobs they&apos;ve had.
        </p>
      </div>
      <CustomersClient customers={customers} crews={crews} terms={terms} />
    </div>
  );
}
