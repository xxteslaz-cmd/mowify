import { getSessionUser } from "@/lib/auth/dal";
import { logout } from "@/app/logout/actions";

/**
 * Read in its own component rather than in the layout so awaiting the session
 * does not hold the rest of the page behind it.
 */
export default async function UserMenu() {
  const user = await getSessionUser();
  if (!user) return null;

  return (
    <div className="ml-auto flex items-center gap-4">
      {user.role === "OWNER" && (
        <a
          href="/team"
          className="text-sm text-black/70 hover:text-black dark:text-white/70 dark:hover:text-white"
        >
          Team
        </a>
      )}
      <span className="text-sm text-black/50 dark:text-white/50">
        {user.name}
      </span>
      <form action={logout}>
        <button
          type="submit"
          className="text-sm text-black/70 hover:text-black dark:text-white/70 dark:hover:text-white"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
