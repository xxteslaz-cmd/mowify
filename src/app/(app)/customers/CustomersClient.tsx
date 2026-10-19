"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Crew, Frequency, ServiceType } from "@prisma/client";
import type { AssigneeTerms } from "@/lib/assignee-terms";
import { todayISO } from "@/lib/date";
import { SERVICE_TYPES, SERVICE_LABEL, FREQUENCIES, FREQUENCY_LABEL } from "@/lib/labels";
import { createCustomer, importCustomers } from "./actions";
import { IMPORT_TEMPLATE, parseImportCsv, type ImportResult } from "@/lib/customer-import";
import { createJob } from "@/app/(app)/dashboard/actions";

type CustomerRow = {
  id: string;
  name: string;
  address: string;
  phone: string | null;
  notes: string | null;
  priceCents: number | null;
  _count: { jobs: number };
};

export default function CustomersClient({
  customers,
  crews,
  terms,
}: {
  customers: CustomerRow[];
  crews: Crew[];
  terms: AssigneeTerms;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

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
        <button onClick={() => setImportOpen(true)} className="shrink-0 btn btn-secondary">
          Import CSV
        </button>
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
            <span className="shrink-0 text-right text-xs text-muted">
              {c.priceCents !== null && (
                <span className="block text-sm font-medium text-foreground">
                  ${(c.priceCents / 100).toFixed(2)}
                </span>
              )}
              {c._count.jobs} {c._count.jobs === 1 ? "job" : "jobs"}
            </span>
          </Link>
        ))}
      </div>

      {importOpen && (
        <ImportModal
          onClose={() => setImportOpen(false)}
          onImported={() => {
            setImportOpen(false);
            router.refresh();
          }}
        />
      )}

      {addOpen && (
        <AddCustomerModal
          crews={crews}
          terms={terms}
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
  terms,
  onClose,
  onCreated,
}: {
  crews: Crew[];
  terms: AssigneeTerms;
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
      setError(`Select a ${terms.one} for the job.`);
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
            <span className="text-xs text-muted">{`(add a ${terms.one} first)`}</span>
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
              <span className="mb-1 block text-muted">{terms.One}</span>
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

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function ImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [text, setText] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    setError(null);
    if (!file) return;
    const t = await file.text();
    setText(t);
    setPreview(parseImportCsv(t));
  }

  async function handleImport() {
    if (!text) return;
    setSubmitting(true);
    const res = await importCustomers(text).catch(() => ({ error: "Something went wrong." }));
    if ("error" in res) {
      setError(res.error);
      setSubmitting(false);
      return;
    }
    onImported();
  }

  const canImport = preview && preview.errors.length === 0 && preview.rows.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[90vh] w-full max-w-3xl flex-col card p-5 shadow-xl">
        <h2 className="text-lg font-semibold">Import customers</h2>
        <p className="mt-1 text-sm text-muted">
          Columns: name, address, phone, mow day, frequency (weekly, biweekly or monthly), price. Only name and
          address are required.{" "}
          <a
            href={`data:text/csv;charset=utf-8,${encodeURIComponent(IMPORT_TEMPLATE)}`}
            download="groundsroute-customers.csv"
            className="font-medium text-brand underline"
          >
            Download the template
          </a>
        </p>

        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => handleFile(e.target.files?.[0])}
          className="mt-4 field"
        />

        {preview && (
          <div className="mt-4 min-h-0 flex-1 overflow-auto">
            {preview.errors.length > 0 && (
              <div className="mb-3 rounded-md bg-danger/10 p-3 text-sm text-danger">
                <p className="font-medium">Fix these rows in your spreadsheet, then choose the file again:</p>
                <ul className="mt-1 list-disc pl-5">
                  {preview.errors.slice(0, 20).map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                  {preview.errors.length > 20 && <li>…and {preview.errors.length - 20} more</li>}
                </ul>
              </div>
            )}
            {preview.rows.length > 0 && (
              <table className="w-full text-left text-sm">
                <thead className="text-muted">
                  <tr>
                    <th className="p-1">Name</th>
                    <th className="p-1">Address</th>
                    <th className="p-1">Phone</th>
                    <th className="p-1">Mow day</th>
                    <th className="p-1">Frequency</th>
                    <th className="p-1">Price</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {preview.rows.map((r) => (
                    <tr key={r.line}>
                      <td className="p-1">{r.name}</td>
                      <td className="p-1">{r.address}</td>
                      <td className="p-1">{r.phone}</td>
                      <td className="p-1">{r.mowDay === null ? "" : DAY_NAMES[r.mowDay]}</td>
                      <td className="p-1">{r.mowFrequency ? FREQUENCY_LABEL[r.mowFrequency] : ""}</td>
                      <td className="p-1">{r.priceCents === null ? "" : `$${(r.priceCents / 100).toFixed(2)}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-secondary">
            Cancel
          </button>
          <button onClick={handleImport} disabled={!canImport || submitting} className="btn btn-primary">
            {submitting
              ? "Importing..."
              : canImport
                ? `Import ${preview.rows.length} customer${preview.rows.length === 1 ? "" : "s"}`
                : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
