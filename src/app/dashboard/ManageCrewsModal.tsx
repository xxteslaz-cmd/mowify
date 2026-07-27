"use client";

import { useState } from "react";
import type { Crew } from "@prisma/client";
import { createCrew, updateCrew } from "./actions";

export default function ManageCrewsModal({
  crews,
  onClose,
  onChanged,
}: {
  crews: Crew[];
  onClose: () => void;
  onChanged: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-5 shadow-xl dark:bg-zinc-900"
      >
        <h2 className="mb-4 text-lg font-semibold">Manage Crews</h2>
        <div className="space-y-2">
          {crews.map((crew) => (
            <CrewRow key={crew.id} crew={crew} onChanged={onChanged} />
          ))}
          {crews.length === 0 && (
            <p className="text-sm text-black/40 dark:text-white/40">No crews yet.</p>
          )}
        </div>

        <NewCrewRow onChanged={onChanged} />

        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-md bg-black px-3 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function CrewRow({ crew, onChanged }: { crew: Crew; onChanged: () => void }) {
  const [name, setName] = useState(crew.name);
  const [color, setColor] = useState(crew.color);
  const [saving, setSaving] = useState(false);
  const dirty = name.trim() !== crew.name || color !== crew.color;

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

  return (
    <div className={`flex items-center gap-2 rounded-md border border-black/10 p-2 dark:border-white/10 ${!crew.active ? "opacity-50" : ""}`}>
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
        className="min-w-0 flex-1 rounded border border-black/10 px-2 py-1 text-sm dark:border-white/10 dark:bg-transparent"
      />
      {dirty && (
        <button
          onClick={save}
          disabled={saving}
          className="shrink-0 rounded bg-black px-2 py-1 text-xs font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          Save
        </button>
      )}
      <button
        onClick={toggleActive}
        disabled={saving}
        className="shrink-0 rounded border border-black/10 px-2 py-1 text-xs disabled:opacity-50 dark:border-white/10"
      >
        {crew.active ? "Deactivate" : "Activate"}
      </button>
    </div>
  );
}

function NewCrewRow({ onChanged }: { onChanged: () => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#2563eb");
  const [submitting, setSubmitting] = useState(false);

  async function add() {
    if (!name.trim()) return;
    setSubmitting(true);
    await createCrew({ name: name.trim(), color });
    setName("");
    setSubmitting(false);
    onChanged();
  }

  return (
    <div className="mt-3 flex items-center gap-2 border-t border-black/10 pt-3 dark:border-white/10">
      <input
        type="color"
        value={color}
        onChange={(e) => setColor(e.target.value)}
        aria-label="New crew color"
        className="h-8 w-8 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
      />
      <input
        type="text"
        placeholder="New crew name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && add()}
        className="min-w-0 flex-1 rounded border border-black/10 px-2 py-1 text-sm dark:border-white/10 dark:bg-transparent"
      />
      <button
        onClick={add}
        disabled={submitting || !name.trim()}
        className="shrink-0 rounded bg-black px-2 py-1 text-xs font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        + Add
      </button>
    </div>
  );
}
