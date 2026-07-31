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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/40 p-4" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto card p-5 shadow-xl"
      >
        <h2 className="mb-4 text-lg font-semibold">Add Job</h2>

        <div className="mb-4">
          <div className="mb-2 flex gap-2">
            <button
              type="button"
              onClick={() => setIsNewCustomer(false)}
              className={`btn ${!isNewCustomer ? "btn-primary" : "btn-secondary"}`}
            >
              Existing customer
            </button>
            <button
              type="button"
              onClick={() => setIsNewCustomer(true)}
              className={`btn ${isNewCustomer ? "btn-primary" : "btn-secondary"}`}
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
                className="field"
              />
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                size={5}
                className="field"
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
                className="field"
              />
              <input
                type="text"
                placeholder="Address"
                value={newAddress}
                onChange={(e) => setNewAddress(e.target.value)}
                className="field"
              />
              <input
                type="text"
                placeholder="Phone (optional)"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                className="field"
              />
              <textarea
                placeholder="Notes: gate code, dog on property, etc."
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                className="field"
                rows={2}
              />
            </div>
          )}
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3">
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
                autoFocus
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

        {error && <p className="mb-3 text-sm text-danger">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-secondary">
            Cancel
          </button>
          <button type="submit" disabled={submitting} className="btn btn-primary">
            {submitting ? "Adding..." : "Add Job"}
          </button>
        </div>
      </form>
    </div>
  );
}
