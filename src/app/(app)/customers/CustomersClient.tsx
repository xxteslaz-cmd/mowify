"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Crew, Frequency, ServiceType } from "@prisma/client";
import { todayISO } from "@/lib/date";
import { SERVICE_TYPES, SERVICE_LABEL, FREQUENCIES, FREQUENCY_LABEL } from "@/lib/labels";
import { createCustomer } from "./actions";
import { createJob } from "@/app/(app)/dashboard/actions";

type CustomerRow = {
  id: string;
  name: string;
  address: string;
  phone: string | null;
  notes: string | null;
  _count: { jobs: number };
};

export default function CustomersClient({ customers, crews }: { customers: CustomerRow[]; crews: Crew[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.address.toLowerCase().includes(q) ||
        (c.phone ?? "").toLowerCase().includes(q),
    );
  }, [customers, search]);

  return (
    <div>
      <div className="mb-4 flex gap-3">
        <input
          type="text"
          placeholder="Search by name, address, or phone..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 field"
        />
        <button onClick={() => setAddOpen(true)} className="shrink-0 btn btn-primary">
          + Add Customer
        </button>
      </div>

      <div className="divide-y divide-border card">
        {filtered.length === 0 && (
          <p className="p-4 text-sm text-muted">No customers found.</p>
        )}
        {filtered.map((c) => (
          <Link
            key={c.id}
            href={`/customers/${c.id}`}
            className="flex items-center justify-between gap-3 p-4 hover:bg-foreground/[.04]"
          >
            <div className="min-w-0">
              <p className="font-medium">{c.name}</p>
              <p className="truncate text-sm text-muted">{c.address}</p>
              {c.phone && <p className="text-sm text-muted">{c.phone}</p>}
            </div>
            <span className="shrink-0 text-xs text-muted">
              {c._count.jobs} {c._count.jobs === 1 ? "job" : "jobs"}
            </span>
          </Link>
        ))}
      </div>

      {addOpen && (
        <AddCustomerModal
          crews={crews}
          onClose={() => setAddOpen(false)}
          onCreated={() => {
            setAddOpen(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function AddCustomerModal({
  crews,
  onClose,
  onCreated,
}: {
  crews: Crew[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [scheduleJob, setScheduleJob] = useState(false);
  const [serviceType, setServiceType] = useState<ServiceType>("MOW");
  const [customService, setCustomService] = useState("");
  const [frequency, setFrequency] = useState<Frequency>("WEEKLY");
  const [date, setDate] = useState(todayISO());
  const [crewId, setCrewId] = useState(crews[0]?.id ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !address.trim()) {
      setError("Name and address are required.");
      return;
    }
    if (scheduleJob && !crewId) {
      setError("Select a crew for the job.");
      return;
    }
    if (scheduleJob && serviceType === "OTHER" && !customService.trim()) {
      setError("Describe the service, or pick a different one.");
      return;
    }
    setSubmitting(true);
    try {
      const newCustomer = {
        name: name.trim(),
        address: address.trim(),
        phone: phone.trim() || undefined,
        notes: notes.trim() || undefined,
      };
      if (scheduleJob) {
        await createJob({
          newCustomer,
          serviceType,
          customService: serviceType === "OTHER" ? customService.trim() : null,
          frequency,
          dateISO: date,
          crewId,
        });
      } else {
        await createCustomer(newCustomer);
      }
      onCreated();
    } catch {
      setError("Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/40 p-4" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="w-full max-w-md card p-5 shadow-xl"
      >
        <h2 className="mb-4 text-lg font-semibold">Add Customer</h2>
        <div className="space-y-2">
          <input
            type="text"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="field"
          />
          <input
            type="text"
            placeholder="Address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="field"
          />
          <input
            type="text"
            placeholder="Phone (optional)"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="field"
          />
          <textarea
            placeholder="Notes: gate code, dog on property, etc."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="field"
          />
        </div>

        <label className="mt-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={scheduleJob}
            disabled={crews.length === 0}
            onChange={(e) => setScheduleJob(e.target.checked)}
            className="h-4 w-4 disabled:opacity-40"
          />
          Schedule a job now
          {crews.length === 0 && (
            <span className="text-xs text-muted">(add a crew first)</span>
          )}
        </label>

        {scheduleJob && (
          <div className="mt-2 grid grid-cols-2 gap-3 rounded-md bg-foreground/5 p-3">
            <label className="text-sm">
              <span className="mb-1 block text-muted">Service</span>
              <select
                value={serviceType}
                onChange={(e) => {
                  const next = e.target.value as ServiceType;
                  setServiceType(next);
                  if (next !== "OTHER") setCustomService("");
                }}
                className="field"
              >
                {SERVICE_TYPES.map((s) => (
                  <option key={s} value={s}>
                    {SERVICE_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-muted">Frequency</span>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as Frequency)}
                className="field"
              >
                {FREQUENCIES.map((f) => (
                  <option key={f} value={f}>
                    {FREQUENCY_LABEL[f]}
                  </option>
                ))}
              </select>
            </label>

            {serviceType === "OTHER" && (
              <label className="col-span-2 text-sm">
                <span className="mb-1 block text-muted">Describe the service</span>
                <input
                  type="text"
                  placeholder="e.g. Leaf removal, hedge trimming"
                  value={customService}
                  onChange={(e) => setCustomService(e.target.value)}
                  className="field"
                />
              </label>
            )}
            <label className="text-sm">
              <span className="mb-1 block text-muted">Date</span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="field"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-muted">Crew</span>
              <select
                value={crewId}
                onChange={(e) => setCrewId(e.target.value)}
                className="field"
              >
                {crews.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-secondary">
            Cancel
          </button>
          <button type="submit" disabled={submitting} className="btn btn-primary">
            {submitting ? "Adding..." : scheduleJob ? "Add Customer & Job" : "Add Customer"}
          </button>
        </div>
      </form>
    </div>
  );
}
