"use client";

import { useState } from "react";
import Link from "next/link";
import type { CustomerWithJobs, JobWithCrew } from "@/lib/types";
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
      <Link href="/customers" className="text-sm text-black/50 hover:text-black dark:text-white/50 dark:hover:text-white">
        ← All customers
      </Link>

      <div className="mt-2 rounded-lg border border-black/10 p-4 dark:border-white/10">
        {!editing ? (
          <>
            <div className="flex items-start justify-between">
              <h1 className="text-xl font-semibold">{customer.name}</h1>
              <button
                onClick={() => setEditing(true)}
                className="rounded-md border border-black/10 px-3 py-1.5 text-sm hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
              >
                Edit
              </button>
            </div>
            <p className="mt-1 text-black/70 dark:text-white/70">{customer.address}</p>
            {customer.phone && <p className="text-black/70 dark:text-white/70">{customer.phone}</p>}
            {customer.notes && (
              <p className="mt-2 rounded bg-black/5 p-2 text-sm italic dark:bg-white/10">{customer.notes}</p>
            )}
          </>
        ) : (
          <div className="space-y-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name"
              className="w-full rounded-md border border-black/10 px-3 py-2 text-sm dark:border-white/10 dark:bg-transparent"
            />
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Address"
              className="w-full rounded-md border border-black/10 px-3 py-2 text-sm dark:border-white/10 dark:bg-transparent"
            />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Phone"
              className="w-full rounded-md border border-black/10 px-3 py-2 text-sm dark:border-white/10 dark:bg-transparent"
            />
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes"
              rows={3}
              className="w-full rounded-md border border-black/10 px-3 py-2 text-sm dark:border-white/10 dark:bg-transparent"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setEditing(false)}
                className="rounded-md border border-black/10 px-3 py-1.5 text-sm dark:border-white/10"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded-md bg-black px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-black/70 dark:text-white/70">Upcoming jobs</h2>
        <JobList jobs={upcoming} empty="No upcoming jobs scheduled." />
      </div>

      <div className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-black/70 dark:text-white/70">Job history</h2>
        <JobList jobs={history} empty="No past jobs yet." />
      </div>
    </div>
  );
}

function JobList({ jobs, empty }: { jobs: JobWithCrew[]; empty: string }) {
  if (jobs.length === 0) {
    return <p className="text-sm text-black/40 dark:text-white/40">{empty}</p>;
  }
  return (
    <div className="divide-y divide-black/10 rounded-lg border border-black/10 dark:divide-white/10 dark:border-white/10">
      {jobs.map((job) => (
        <div key={job.id} className="flex items-center justify-between p-3 text-sm">
          <div>
            <span className="font-medium">
              {job.scheduledDate.toISOString().slice(0, 10)}
            </span>{" "}
            <span className="text-black/60 dark:text-white/60">
              {serviceLabel(job)}
              {job.frequency !== "ONE_TIME" ? ` (${FREQUENCY_LABEL[job.frequency]})` : ""}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {job.crew && (
              <span className="flex items-center gap-1 text-xs text-black/50 dark:text-white/50">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: job.crew.color }} />
                {job.crew.name}
              </span>
            )}
            <span className="rounded bg-black/5 px-1.5 py-0.5 text-xs dark:bg-white/10">{job.status}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
