import { getAssigneeMode } from "@/lib/data";
import SettingsClient from "./SettingsClient";

export default async function SettingsPage() {
  const mode = await getAssigneeMode();

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="text-xl font-semibold">Settings</h1>

      <div className="card mt-4 p-6">
        <h2 className="text-sm font-medium">How do you assign work?</h2>
        <p className="mb-4 mt-1 text-sm text-muted">
          This changes the wording across the app. Your existing jobs and
          people are not affected either way.
        </p>
        <SettingsClient mode={mode} />
      </div>
    </div>
  );
}
