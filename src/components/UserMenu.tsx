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
    <div className="flex items-center gap-4 md:w-full md:flex-col md:items-stretch md:gap-1">
      {user.role === "OWNER" && (
        <div className="flex items-center gap-4 md:w-full md:flex-col md:items-stretch md:gap-1">
          <a
            href="/team"
            className="text-sm text-muted hover:text-foreground md:rounded-md md:px-3 md:py-1.5 md:hover:bg-foreground/5 md:hover:text-foreground"
          >
            Team
          </a>
          <a
            href="/account"
            className="text-sm text-muted hover:text-foreground md:rounded-md md:px-3 md:py-1.5 md:hover:bg-foreground/5 md:hover:text-foreground"
          >
            Account
          </a>
        </div>
      )}
      <div className="flex items-center gap-3 md:w-full md:flex-col md:items-stretch md:gap-2 md:border-t md:border-border md:pt-3">
        <span className="text-sm text-muted md:truncate md:px-3">
          {user.name}
        </span>
        <form action={logout} className="md:w-full">
          <button type="submit" className="btn btn-ghost md:w-full md:justify-start">
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
