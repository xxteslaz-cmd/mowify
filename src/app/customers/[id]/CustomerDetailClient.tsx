"use client";

import { useState } from "react";
import Link from "next/link";
import type { CustomerWithJobs, JobWithCrew } from "@/lib/types";
import { toISODate } from "@/lib/date";
import { FREQUENCY_LABEL, serviceLabel } from "@/lib/labels";
import { updateCustomer } from "../actions";

export default function CustomerDetailClient({
  customer,
  upcoming,
  history,
}: {
  customer: CustomerWithJobs;
  upcoming: JobWithCrew[];
  history: JobWithCrew[];
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(customer.name);
  const [address, setAddress] = useState(customer.address);
  const [phone, setPhone] = useState(customer.phone ?? "");
  const [notes, setNotes] = useState(customer.notes ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    await updateCustomer(customer.id, {
      name: name.trim(),
      address: address.trim(),
      phone: phone.trim() || undefined,
      notes: notes.trim() || undefined,
    });
    setSaving(false);
    setEditing(false);
  }

  return (
    <div>
      <Link href="/customers" className="text-sm text-muted hover:text-foreground">
        ← All customers
      </Link>

      {/* A name-and-address card reads badly stretched edge to edge, so it
          keeps a reading width even though the page around it doesn't. */}
      <div className="mt-2 max-w-2xl card p-4">
        {!editing ? (
          <>
            <div className="flex items-start justify-between">
              <h1 className="text-xl font-semibold">{customer.name}</h1>
              <button onClick={() => setEditing(true)} className="btn btn-secondary">
                Edit
              </button>
            </div>
            <p className="mt-1 text-muted">{customer.address}</p>
            {customer.phone && <p className="text-muted">{customer.phone}</p>}
            {customer.notes && (
              <p className="mt-2 rounded bg-foreground/5 p-2 text-sm italic">{customer.notes}</p>
            )}
          </>
        ) : (
          <div className="space-y-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name"
              className="field"
            />
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Address"
              className="field"
            />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Phone"
              className="field"
            />
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes"
              rows={3}
              className="field"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditing(false)} className="btn btn-secondary">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving} className="btn btn-primary">
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-6 max-w-4xl">
        <h2 className="mb-2 text-sm font-semibold text-muted">Upcoming jobs</h2>
        <JobList jobs={upcoming} empty="No upcoming jobs scheduled." />
      </div>

      <div className="mt-6 max-w-4xl">
        <h2 className="mb-2 text-sm font-semibold text-muted">Job history</h2>
        <JobList jobs={history} empty="No past jobs yet." />
      </div>
    </div>
  );
}

function JobList({ jobs, empty }: { jobs: JobWithCrew[]; empty: string }) {
  if (jobs.length === 0) {
    return <p className="text-sm text-muted">{empty}</p>;
  }
  return (
    <div className="divide-y divide-border card">
      {jobs.map((job) => (
        <div key={job.id} className="flex items-center justify-between p-3 text-sm">
          <div>
            <span className="font-medium">
              {toISODate(job.scheduledDate)}
            </span>{" "}
            <span className="text-muted">
              {serviceLabel(job)}
              {job.frequency !== "ONE_TIME" ? ` (${FREQUENCY_LABEL[job.frequency]})` : ""}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {job.crew && (
              <span className="flex items-center gap-1 text-xs text-muted">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: job.crew.color }} />
                {job.crew.name}
              </span>
            )}
            <span className="rounded bg-foreground/5 px-1.5 py-0.5 text-xs">{job.status}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
