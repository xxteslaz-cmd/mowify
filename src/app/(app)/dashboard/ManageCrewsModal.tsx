"use client";

import { useState } from "react";
import type { CrewWithJobCount } from "@/lib/types";
import { isEmployeeTerms, type AssigneeTerms } from "@/lib/assignee-terms";
import {
  createCrew,
  createAssigneeWithLogin,
  updateCrew,
  deleteCrew,
} from "./actions";

export default function ManageCrewsModal({
  crews,
  terms,
  onClose,
  onChanged,
}: {
  crews: CrewWithJobCount[];
  terms: AssigneeTerms;
  onClose: () => void;
  onChanged: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/40 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full max-w-md overflow-y-auto card p-5 shadow-xl"
      >
        <h2 className="mb-4 text-lg font-semibold">{`Manage ${terms.Many}`}</h2>
        <div className="space-y-2">
          {crews.map((crew) => (
            <CrewRow key={crew.id} crew={crew} terms={terms} onChanged={onChanged} />
          ))}
          {crews.length === 0 && (
            <p className="text-sm text-muted">{`No ${terms.many} yet.`}</p>
          )}
        </div>

        <NewCrewRow terms={terms} onChanged={onChanged} />

        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="btn btn-primary">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function CrewRow({
  crew,
  terms,
  onChanged,
}: {
  crew: CrewWithJobCount;
  terms: AssigneeTerms;
  onChanged: () => void;
}) {
  const [name, setName] = useState(crew.name);
  const [color, setColor] = useState(crew.color);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = name.trim() !== crew.name || color !== crew.color;
  const jobCount = crew._count.jobs;

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    await updateCrew(crew.id, { name: name.trim(), color });
    setSaving(false);
    onChanged();
  }

  async function toggleActive() {
    setSaving(true);
    await updateCrew(crew.id, { active: !crew.active });
    setSaving(false);
    onChanged();
  }

  async function remove() {
    if (!confirm(`Delete ${terms.one} "${crew.name}"? This cannot be undone.`))
      return;
    setSaving(true);
    setError(null);
    try {
      await deleteCrew(crew.id);
      onChanged();
    } catch {
      // The count we rendered can go stale if a job was assigned meanwhile.
      setError(
        `Couldn't delete this ${terms.one} — it may have jobs assigned now.`,
      );
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`card p-2 ${!crew.active ? "opacity-50" : ""}`}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          aria-label={`${crew.name} color`}
          className="h-8 w-8 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
        />
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="min-w-0 flex-1 field"
        />
        {dirty && (
          <button onClick={save} disabled={saving} className="shrink-0 btn btn-primary">
            Save
          </button>
        )}
        <button onClick={toggleActive} disabled={saving} className="shrink-0 btn btn-secondary">
          {crew.active ? "Deactivate" : "Activate"}
        </button>
        <button
          onClick={remove}
          disabled={saving || jobCount > 0}
          title={
            jobCount > 0
              ? `Can't delete: ${terms.one} has ${jobCount} job${jobCount === 1 ? "" : "s"}`
              : `Delete ${crew.name}`
          }
          className="shrink-0 btn btn-danger"
        >
          Delete
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}

function NewCrewRow({
  terms,
  onChanged,
}: {
  terms: AssigneeTerms;
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#2563eb");
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A crew is a group that people are added to from /team; an employee is one
  // person, so their login is worth offering in the same step rather than
  // sending the owner to a second screen to finish the job.
  const employeeMode = isEmployeeTerms(terms);

  async function add() {
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);

    if (!employeeMode) {
      await createCrew({ name: name.trim(), color });
    } else {
      const result = await createAssigneeWithLogin({
        name: name.trim(),
        color,
        // Send neither when both are blank, so an employee without a login is
        // still valid; the action rejects one without the other.
        username: username.trim() || undefined,
        pin: pin.trim() || undefined,
      });
      if (!result.ok) {
        setError(result.error);
        setSubmitting(false);
        return;
      }
    }

    setName("");
    setUsername("");
    setPin("");
    setSubmitting(false);
    onChanged();
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          aria-label={`New ${terms.one} color`}
          className="h-8 w-8 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
        />
        <input
          type="text"
          placeholder={`New ${terms.one} name`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          className="min-w-0 flex-1 field"
        />
        <button
          onClick={add}
          disabled={submitting || !name.trim()}
          className="shrink-0 btn btn-primary"
        >
          + Add
        </button>
      </div>

      {employeeMode && (
        <div className="mt-2 flex items-center gap-2">
          <input
            type="text"
            placeholder="Username (optional)"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            autoComplete="off"
            className="min-w-0 flex-1 field"
          />
          <input
            type="text"
            inputMode="numeric"
            placeholder="6-digit PIN (optional)"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            autoComplete="off"
            className="min-w-0 flex-1 field"
          />
        </div>
      )}

      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
