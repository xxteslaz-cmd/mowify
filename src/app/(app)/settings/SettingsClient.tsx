"use client";

import { useState, useTransition } from "react";
import type { AssigneeMode } from "@prisma/client";
import { updateAssigneeMode } from "./actions";

const OPTIONS: { value: AssigneeMode; label: string; hint: string }[] = [
  {
    value: "CREW",
    label: "We work in crews",
    hint: "Jobs are assigned to a crew, and a crew can have several people.",
  },
  {
    value: "EMPLOYEE",
    label: "We assign work to people",
    hint: "Jobs are assigned to a named employee. Nothing is deleted if you switch back.",
  },
];

export default function SettingsClient({ mode }: { mode: AssigneeMode }) {
  const [current, setCurrent] = useState<AssigneeMode>(mode);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function choose(next: AssigneeMode) {
    if (next === current) return;
    // Move the radio immediately and put it back only if the write fails, so
    // the control does not sit visibly behind the click on a slow connection.
    const previous = current;
    setCurrent(next);
    setError(null);
    startTransition(async () => {
      const result = await updateAssigneeMode(next);
      if ("error" in result) {
        setCurrent(previous);
        setError(result.error);
      }
    });
  }

  return (
    <div className="space-y-3">
      {OPTIONS.map((option) => (
        <label
          key={option.value}
          className="flex cursor-pointer gap-3 rounded-md border border-border p-3"
        >
          <input
            type="radio"
            name="assigneeMode"
            className="mt-1"
            checked={current === option.value}
            disabled={pending}
            onChange={() => choose(option.value)}
          />
          <span>
            <span className="block text-sm font-medium">{option.label}</span>
            <span className="block text-sm text-muted">{option.hint}</span>
          </span>
        </label>
      ))}
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </div>
  );
}
