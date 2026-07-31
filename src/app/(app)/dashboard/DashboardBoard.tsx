"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Crew, Customer, Frequency } from "@prisma/client";
import type { JobWithNextDate, CrewWithJobCount } from "@/lib/types";
import { toISODate, calculateNextOccurrenceDate } from "@/lib/date";
import { serviceLabel } from "@/lib/labels";
import AutoRefresh from "@/components/AutoRefresh";
import JobCard from "./JobCard";
import AddJobModal from "./AddJobModal";
import EditJobModal from "./EditJobModal";
import ManageCrewsModal from "./ManageCrewsModal";
import { deleteJob, bulkRescheduleDay, updateJobFrequency, moveJobInColumn } from "./actions";

type ColumnKey = string;

/**
 * Fields whose change should pull the board back to server truth. Compared as a
 * string so an unchanged poll is a no-op rather than a re-render that would
 * discard an in-flight optimistic update.
 */
function signatureOf(jobs: JobWithNextDate[]) {
  return jobs
    .map((j) =>
      [j.id, j.crewId, j.orderInDay, j.status, j.frequency, j.serviceType, j.customService ?? ""].join(
        ":",
      ),
    )
    .join("|");
}

export default function DashboardBoard({
  dateISO,
  crews,
  allCrews,
  jobs,
  customers,
}: {
  dateISO: string;
  crews: Crew[];
  allCrews: CrewWithJobCount[];
  jobs: JobWithNextDate[];
  customers: Customer[];
}) {
  const router = useRouter();
  const [localJobs, setLocalJobs] = useState(jobs);
  const [addOpen, setAddOpen] = useState(false);
  const [addDefaultCrew, setAddDefaultCrew] = useState<string | null>(null);
  const [editJob, setEditJob] = useState<JobWithNextDate | null>(null);
  const [manageCrewsOpen, setManageCrewsOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rescheduleDate, setRescheduleDate] = useState(dateISO);
  const [pending, setPending] = useState(false);

  // Polled refreshes hand down a new `jobs` prop, which plain useState would
  // ignore. Adopting it during render keeps the board live without a remount.
  const incomingSignature = useMemo(() => signatureOf(jobs), [jobs]);
  const [syncedSignature, setSyncedSignature] = useState(incomingSignature);
  if (incomingSignature !== syncedSignature) {
    setSyncedSignature(incomingSignature);
    setLocalJobs(jobs);
  }

  const columns = useMemo(() => {
    const map = new Map<ColumnKey, JobWithNextDate[]>();
    for (const crew of crews) map.set(crew.id, []);
    for (const job of localJobs) {
      if (!map.has(job.crewId)) map.set(job.crewId, []);
      map.get(job.crewId)!.push(job);
    }
    for (const list of map.values()) list.sort((a, b) => a.orderInDay - b.orderInDay);
    return map;
  }, [localJobs, crews]);

  async function handleMove(job: JobWithNextDate, direction: "up" | "down") {
    const list = columns.get(job.crewId) ?? [];
    const index = list.findIndex((j) => j.id === job.id);
    const target = direction === "up" ? index - 1 : index + 1;
    if (index === -1 || target < 0 || target >= list.length) return;

    const reordered = [...list];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    const positions = new Map(reordered.map((j, i) => [j.id, i]));

    setLocalJobs((prev) =>
      prev.map((j) => (positions.has(j.id) ? { ...j, orderInDay: positions.get(j.id)! } : j)),
    );

    setPending(true);
    await moveJobInColumn({ jobId: job.id, direction });
    router.refresh();
    setPending(false);
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleDelete(job: JobWithNextDate) {
    if (!confirm(`Remove ${job.customer.name}'s ${serviceLabel(job)} job from the schedule?`)) return;
    setLocalJobs((prev) => prev.filter((j) => j.id !== job.id));
    await deleteJob(job.id, dateISO, job.crewId);
    router.refresh();
  }

  async function handleFrequencyChange(job: JobWithNextDate, frequency: Frequency) {
    // This job hasn't produced a next occurrence yet (that only happens once
    // it's completed/skipped), so recalculating from the new frequency is
    // accurate here and can't drift from what generation will later produce.
    const nextDate = calculateNextOccurrenceDate(job.scheduledDate, frequency);
    setLocalJobs((prev) =>
      prev.map((j) => (j.id === job.id ? { ...j, frequency, nextDate } : j)),
    );
    const updated = await updateJobFrequency(job.id, frequency, dateISO, job.crewId);
    setLocalJobs((prev) =>
      prev.map((j) => (j.id === job.id ? { ...updated, nextDate } : j)),
    );
    router.refresh();
  }

  async function handleBulkReschedule() {
    if (selected.size === 0 || rescheduleDate === dateISO) return;
    setPending(true);
    await bulkRescheduleDay({
      dateISO,
      newDateISO: rescheduleDate,
      jobIds: Array.from(selected),
    });
    setSelected(new Set());
    setSelectMode(false);
    setPending(false);
    router.push(`/dashboard?date=${rescheduleDate}`);
  }

  return (
    <div>
      {/* A refresh landing mid-save or under an open dialog would yank the
          card out from under the user. */}
      <AutoRefresh paused={pending || addOpen || editJob !== null || manageCrewsOpen} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button
          onClick={() => {
            setAddDefaultCrew(null);
            setAddOpen(true);
          }}
          disabled={crews.length === 0}
          title={crews.length === 0 ? "Create a crew before adding jobs" : undefined}
          className="btn btn-primary disabled:opacity-40"
        >
          + Add Job
        </button>
        <button
          onClick={() => {
            setSelectMode((s) => !s);
            setSelected(new Set());
          }}
          className={
            selectMode
              ? "btn border-blue-400 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
              : "btn btn-secondary"
          }
        >
          {selectMode ? "Cancel selection" : "Select & reschedule"}
        </button>
        <button onClick={() => setManageCrewsOpen(true)} className="btn btn-secondary">
          Manage Crews
        </button>

        {selectMode && selected.size > 0 && (
          <div className="flex items-center gap-2 rounded-md bg-foreground/5 px-3 py-2">
            <span className="text-sm">{selected.size} selected</span>
            <span className="text-sm text-muted">Move to</span>
            <input
              type="date"
              value={rescheduleDate}
              onChange={(e) => setRescheduleDate(e.target.value)}
              className="field"
            />
            <button onClick={handleBulkReschedule} disabled={pending} className="btn btn-primary">
              Move
            </button>
          </div>
        )}
      </div>

      {crews.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center">
          <p className="text-sm text-muted">
            No active crews yet. Every job belongs to a crew, so add one to start scheduling.
          </p>
          <button onClick={() => setManageCrewsOpen(true)} className="mt-3 btn btn-primary">
            Add a crew
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {crews.map(({ id: key, name, color }) => {
            const list = columns.get(key) ?? [];
            return (
              <div
                key={key}
                className="flex min-h-[120px] flex-col gap-2 rounded-lg bg-foreground/[.03] p-2"
              >
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
                    <h2 className="text-sm font-semibold">{name}</h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/crew/${key}/today?date=${dateISO}`}
                      className="text-xs text-muted hover:text-foreground"
                      title="Open this crew's phone view"
                    >
                      view
                    </Link>
                    <button
                      onClick={() => {
                        setAddDefaultCrew(key);
                        setAddOpen(true);
                      }}
                      className="text-xs text-muted hover:text-foreground"
                    >
                      + job
                    </button>
                  </div>
                </div>

                {list.length === 0 && (
                  <p className="px-1 py-6 text-center text-xs text-muted">
                    No jobs
                  </p>
                )}

                {list.map((job, index) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    crewColor={color}
                    selectMode={selectMode}
                    selected={selected.has(job.id)}
                    onToggleSelect={() => toggleSelected(job.id)}
                    onDelete={() => handleDelete(job)}
                    onEdit={() => setEditJob(job)}
                    onFrequencyChange={(frequency) => handleFrequencyChange(job, frequency)}
                    onMoveUp={() => handleMove(job, "up")}
                    onMoveDown={() => handleMove(job, "down")}
                    isFirst={index === 0}
                    isLast={index === list.length - 1}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}

      {addOpen && (
        <AddJobModal
          dateISO={dateISO}
          crews={crews}
          customers={customers}
          defaultCrewId={addDefaultCrew}
          onClose={() => setAddOpen(false)}
          onCreated={(job) => {
            if (toISODate(job.scheduledDate) === dateISO) {
              const nextDate = calculateNextOccurrenceDate(job.scheduledDate, job.frequency);
              setLocalJobs((prev) => [...prev, { ...job, nextDate }]);
            }
            setAddOpen(false);
            router.refresh();
          }}
        />
      )}

      {editJob && (
        <EditJobModal
          job={editJob}
          crews={crews}
          onClose={() => setEditJob(null)}
          onSaved={() => {
            setEditJob(null);
            // Server truth comes back through the jobs prop; the edit may have
            // moved the job off this day entirely.
            router.refresh();
          }}
        />
      )}

      {manageCrewsOpen && (
        <ManageCrewsModal
          crews={allCrews}
          onClose={() => setManageCrewsOpen(false)}
          onChanged={() => router.refresh()}
        />
      )}
    </div>
  );
}
