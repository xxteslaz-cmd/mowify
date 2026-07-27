"use client";

import { useMemo, useState } from "react";
import type { Crew, Customer, Frequency, ServiceType } from "@prisma/client";
import type { JobWithRelations } from "@/lib/types";
import { SERVICE_TYPES, SERVICE_LABEL, FREQUENCIES, FREQUENCY_LABEL } from "@/lib/labels";
import { createJob } from "./actions";

export default function AddJobModal({
  dateISO,
  crews,
  customers,
  defaultCrewId,
  onClose,
  onCreated,
}: {
  dateISO: string;
  crews: Crew[];
  customers: Customer[];
  defaultCrewId: string | null;
  onClose: () => void;
  onCreated: (job: JobWithRelations) => void;
}) {
  const [isNewCustomer, setIsNewCustomer] = useState(customers.length === 0);
  const [search, setSearch] = useState("");
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [newName, setNewName] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [serviceType, setServiceType] = useState<ServiceType>("MOW");
  const [customService, setCustomService] = useState("");
  const [frequency, setFrequency] = useState<Frequency>("WEEKLY");
  const [date, setDate] = useState(dateISO);
  const [crewId, setCrewId] = useState<string>(defaultCrewId ?? crews[0]?.id ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) => c.name.toLowerCase().includes(q) || c.address.toLowerCase().includes(q),
    );
  }, [customers, search]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (isNewCustomer && (!newName.trim() || !newAddress.trim())) {
      setError("Customer name and address are required.");
      return;
    }
    if (!isNewCustomer && !customerId) {
      setError("Select a customer.");
      return;
    }
    if (!crewId) {
      setError("Select a crew.");
      return;
    }
    if (serviceType === "OTHER" && !customService.trim()) {
      setError("Describe the service, or pick a different one.");
      return;
    }

    setSubmitting(true);
    try {
      const job = await createJob({
        customerId: isNewCustomer ? undefined : customerId,
        newCustomer: isNewCustomer
          ? { name: newName.trim(), address: newAddress.trim(), phone: newPhone.trim() || undefined, notes: newNotes.trim() || undefined }
          : undefined,
        serviceType,
        customService: serviceType === "OTHER" ? customService.trim() : null,
        frequency,
        dateISO: date,
        crewId,
      });
      onCreated(job);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-5 shadow-xl dark:bg-zinc-900"
      >
        <h2 className="mb-4 text-lg font-semibold">Add Job</h2>

        <div className="mb-4">
          <div className="mb-2 flex gap-2">
            <button
              type="button"
              onClick={() => setIsNewCustomer(false)}
              className={`rounded px-2 py-1 text-xs font-medium ${!isNewCustomer ? "bg-black text-white dark:bg-white dark:text-black" : "bg-black/5 dark:bg-white/10"}`}
            >
              Existing customer
            </button>
            <button
              type="button"
              onClick={() => setIsNewCustomer(true)}
              className={`rounded px-2 py-1 text-xs font-medium ${isNewCustomer ? "bg-black text-white dark:bg-white dark:text-black" : "bg-black/5 dark:bg-white/10"}`}
            >
              New customer
            </button>
          </div>

          {!isNewCustomer ? (
            <div className="space-y-2">
              <input
                type="text"
                placeholder="Search customers..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-md border border-black/10 px-3 py-2 text-sm dark:border-white/10 dark:bg-transparent"
              />
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                size={5}
                className="w-full rounded-md border border-black/10 px-3 py-2 text-sm dark:border-white/10 dark:bg-transparent"
              >
                {filtered.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — {c.address}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="space-y-2">
              <input
                type="text"
                placeholder="Customer name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full rounded-md border border-black/10 px-3 py-2 text-sm dark:border-white/10 dark:bg-transparent"
              />
              <input
                type="text"
                placeholder="Address"
                value={newAddress}
                onChange={(e) => setNewAddress(e.target.value)}
                className="w-full rounded-md border border-black/10 px-3 py-2 text-sm dark:border-white/10 dark:bg-transparent"
              />
              <input
                type="text"
                placeholder="Phone (optional)"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                className="w-full rounded-md border border-black/10 px-3 py-2 text-sm dark:border-white/10 dark:bg-transparent"
              />
              <textarea
                placeholder="Notes: gate code, dog on property, etc."
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                className="w-full rounded-md border border-black/10 px-3 py-2 text-sm dark:border-white/10 dark:bg-transparent"
                rows={2}
              />
            </div>
          )}
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-black/60 dark:text-white/60">Service</span>
            <select
              value={serviceType}
              onChange={(e) => {
                const next = e.target.value as ServiceType;
                setServiceType(next);
                if (next !== "OTHER") setCustomService("");
              }}
              className="w-full rounded-md border border-black/10 px-2 py-2 text-sm dark:border-white/10 dark:bg-transparent"
            >
              {SERVICE_TYPES.map((s) => (
                <option key={s} value={s}>
                  {SERVICE_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-black/60 dark:text-white/60">Frequency</span>
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as Frequency)}
              className="w-full rounded-md border border-black/10 px-2 py-2 text-sm dark:border-white/10 dark:bg-transparent"
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
              <span className="mb-1 block text-black/60 dark:text-white/60">Describe the service</span>
              <input
                type="text"
                autoFocus
                placeholder="e.g. Leaf removal, hedge trimming"
                value={customService}
                onChange={(e) => setCustomService(e.target.value)}
                className="w-full rounded-md border border-black/10 px-2 py-2 text-sm dark:border-white/10 dark:bg-transparent"
              />
            </label>
          )}
          <label className="text-sm">
            <span className="mb-1 block text-black/60 dark:text-white/60">Date</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-md border border-black/10 px-2 py-2 text-sm dark:border-white/10 dark:bg-transparent"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-black/60 dark:text-white/60">Crew</span>
            <select
              value={crewId}
              onChange={(e) => setCrewId(e.target.value)}
              className="w-full rounded-md border border-black/10 px-2 py-2 text-sm dark:border-white/10 dark:bg-transparent"
            >
              {crews.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-black/10 px-3 py-2 text-sm dark:border-white/10"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
          >
            {submitting ? "Adding..." : "Add Job"}
          </button>
        </div>
      </form>
    </div>
  );
}
