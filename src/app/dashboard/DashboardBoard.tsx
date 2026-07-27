"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Crew, Customer, Frequency } from "@prisma/client";
import type { JobWithNextDate, CrewWithJobCount } from "@/lib/types";
import { toISODate, calculateNextOccurrenceDate } from "@/lib/date";
import JobCard from "./JobCard";
import AddJobModal from "./AddJobModal";
import ManageCrewsModal from "./ManageCrewsModal";
import { reorderColumn, deleteJob, bulkRescheduleDay, updateJobFrequency } from "./actions";

const UNASSIGNED = "unassigned";

type ColumnKey = string;

function columnKeyFor(crewId: string | null) {
  return crewId ?? UNASSIGNED;
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
  const [manageCrewsOpen, setManageCrewsOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dragJobId, setDragJobId] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<{ col: ColumnKey; index: number } | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState(dateISO);
  const [pending, setPending] = useState(false);

  const columns = useMemo(() => {
    const map = new Map<ColumnKey, JobWithNextDate[]>();
    map.set(UNASSIGNED, []);
    for (const crew of crews) map.set(crew.id, []);
    for (const job of localJobs) {
      const key = columnKeyFor(job.crewId);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(job);
    }
    for (const list of map.values()) list.sort((a, b) => a.orderInDay - b.orderInDay);
    return map;
  }, [localJobs, crews]);

  async function persistColumn(col: ColumnKey, jobIds: string[]) {
    setPending(true);
    await reorderColumn({
      dateISO,
      crewId: col === UNASSIGNED ? null : col,
      orderedJobIds: jobIds,
    });
    router.refresh();
    setPending(false);
  }

  function handleDrop(targetCol: ColumnKey) {
    if (!dragJobId) return;
    const job = localJobs.find((j) => j.id === dragJobId);
    if (!job) return;
    const sourceCol = columnKeyFor(job.crewId);
    const insertIndex = dragOverKey?.col === targetCol ? dragOverKey.index : columns.get(targetCol)?.length ?? 0;

    const next = [...localJobs];
    const withoutDragged = next.filter((j) => j.id !== dragJobId);

    const destList = withoutDragged
      .filter((j) => columnKeyFor(j.crewId) === targetCol)
      .sort((a, b) => a.orderInDay - b.orderInDay);
    destList.splice(insertIndex, 0, job);

    const targetCrewId = targetCol === UNASSIGNED ? null : targetCol;
    const updatedDest = destList.map((j, i) => ({
      ...j,
      crewId: targetCrewId,
      orderInDay: i,
    }));

    const untouched = withoutDragged.filter((j) => columnKeyFor(j.crewId) !== targetCol);
    const merged = [...untouched, ...updatedDest];

    setLocalJobs(merged);
    setDragJobId(null);
    setDragOverKey(null);

    void persistColumn(
      targetCol,
      updatedDest.map((j) => j.id),
    );
    if (sourceCol !== targetCol) {
      const remainingSource = untouched
        .filter((j) => columnKeyFor(j.crewId) === sourceCol)
        .sort((a, b) => a.orderInDay - b.orderInDay);
      if (remainingSource.length) {
        void persistColumn(
          sourceCol,
          remainingSource.map((j) => j.id),
        );
      }
    }
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
    if (!confirm(`Remove ${job.customer.name}'s ${job.serviceType} job from the schedule?`)) return;
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

  const allColumns: { key: ColumnKey; name: string; color?: string }[] = [
    { key: UNASSIGNED, name: "Unassigned" },
    ...crews.map((c) => ({ key: c.id, name: c.name, color: c.color })),
  ];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button
          onClick={() => {
            setAddDefaultCrew(null);
            setAddOpen(true);
          }}
          className="rounded-md bg-black px-3 py-2 text-sm font-medium text-white hover:bg-black/80 dark:bg-white dark:text-black dark:hover:bg-white/80"
        >
          + Add Job
        </button>
        <button
          onClick={() => {
            setSelectMode((s) => !s);
            setSelected(new Set());
          }}
          className={`rounded-md border px-3 py-2 text-sm font-medium ${
            selectMode
              ? "border-blue-400 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
              : "border-black/10 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
          }`}
        >
          {selectMode ? "Cancel selection" : "Select & reschedule"}
        </button>
        <button
          onClick={() => setManageCrewsOpen(true)}
          className="rounded-md border border-black/10 px-3 py-2 text-sm font-medium hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
        >
          Manage Crews
        </button>

        {selectMode && selected.size > 0 && (
          <div className="flex items-center gap-2 rounded-md bg-black/5 px-3 py-2 dark:bg-white/10">
            <span className="text-sm">{selected.size} selected</span>
            <span className="text-sm text-black/60 dark:text-white/60">Move to</span>
            <input
              type="date"
              value={rescheduleDate}
              onChange={(e) => setRescheduleDate(e.target.value)}
              className="rounded border border-black/10 px-2 py-1 text-sm dark:border-white/10 dark:bg-transparent"
            />
            <button
              onClick={handleBulkReschedule}
              disabled={pending}
              className="rounded bg-black px-2 py-1 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
            >
              Move
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {allColumns.map(({ key, name, color }) => {
          const list = columns.get(key) ?? [];
          return (
            <div
              key={key}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverKey((prev) => (prev && prev.col === key ? prev : { col: key, index: list.length }));
              }}
              onDrop={(e) => {
                e.preventDefault();
                handleDrop(key);
              }}
              className="flex min-h-[120px] flex-col gap-2 rounded-lg bg-black/[.03] p-2 dark:bg-white/[.04]"
            >
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  {color && <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />}
                  <h2 className="text-sm font-semibold">{name}</h2>
                </div>
                {key !== UNASSIGNED && (
                  <div className="flex items-center gap-2">
                    <a
                      href={`/crew/${key}/today?date=${dateISO}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-black/40 hover:text-black/70 dark:text-white/40 dark:hover:text-white/70"
                      title="Open this crew's phone view"
                    >
                      view ↗
                    </a>
                    <button
                      onClick={() => {
                        setAddDefaultCrew(key);
                        setAddOpen(true);
                      }}
                      className="text-xs text-black/40 hover:text-black/70 dark:text-white/40 dark:hover:text-white/70"
                    >
                      + job
                    </button>
                  </div>
                )}
              </div>

              {list.length === 0 && (
                <p className="px-1 py-6 text-center text-xs text-black/30 dark:text-white/30">No jobs</p>
              )}

              {list.map((job, index) => (
                <div
                  key={job.id}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDragOverKey({ col: key, index });
                  }}
                >
                  <JobCard
                    job={job}
                    crewColor={color}
                    selectMode={selectMode}
                    selected={selected.has(job.id)}
                    onToggleSelect={() => toggleSelected(job.id)}
                    onDelete={() => handleDelete(job)}
                    onFrequencyChange={(frequency) => handleFrequencyChange(job, frequency)}
                    onDragStart={() => setDragJobId(job.id)}
                    onDragOverCard={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDragOverKey({ col: key, index });
                    }}
                    isDragOver={dragOverKey?.col === key && dragOverKey.index === index && dragJobId !== job.id}
                  />
                </div>
              ))}
            </div>
          );
        })}
      </div>

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
