import { getAssigneeMode } from "@/lib/data";
import { RETENTION } from "@/lib/legal";
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

      <div className="card mt-4 p-6">
        <h2 className="text-sm font-medium">Export your data</h2>
        <p className="mb-4 mt-1 text-sm text-muted">
          Downloads everything this company has in GroundsRoute — your
          customers, crews and every job — as a single JSON file. Your crew
          logins are listed by name and username; passwords and PINs are not
          included, because they are not stored in a readable form.
        </p>
        {/* A plain link, not a fetch: the browser's own download handling is
            what turns the response into a saved file, and the route sets the
            Content-Disposition that names it. */}
        <a href="/api/export" className="btn btn-secondary" download>
          Download my data
        </a>
        <p className="mt-3 text-xs text-muted">
          Available whether or not your subscription is active. If your account
          lapses, your data stays available to export for{" "}
          {RETENTION.accountDays} days before it is deleted.
        </p>
      </div>
    </div>
  );
}
