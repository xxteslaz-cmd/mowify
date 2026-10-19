"use client";

import { useState, useTransition } from "react";
import { updateWeatherZip } from "./actions";

export default function WeatherZipForm({ zip, place }: { zip: string | null; place: string | null }) {
  const [value, setValue] = useState(zip ?? "");
  const [saved, setSaved] = useState(place);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await updateWeatherZip(value);
      if ("error" in result) setError(result.error);
      else setSaved(result.place);
    });
  }

  return (
    <form onSubmit={save} className="flex flex-wrap items-center gap-2">
      <input
        type="text"
        inputMode="numeric"
        autoComplete="postal-code"
        maxLength={5}
        placeholder="ZIP code"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="field w-32"
      />
      <button type="submit" disabled={pending} className="btn btn-secondary">
        {pending ? "Saving..." : "Save"}
      </button>
      {saved && !error && <span className="text-sm text-muted">Forecasts for {saved}</span>}
      {error && <p className="w-full text-sm text-danger">{error}</p>}
    </form>
  );
}
