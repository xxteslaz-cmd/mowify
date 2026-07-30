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
        <>
          <a
            href="/team"
            className="text-sm text-muted hover:text-foreground"
          >
            Team
          </a>
          <a
            href="/account"
            className="text-sm text-muted hover:text-foreground"
          >
            Account
          </a>
        </>
      )}
      <span className="text-sm text-muted">
        {user.name}
      </span>
      <form action={logout}>
        <button type="submit" className="btn btn-ghost">
          Sign out
        </button>
      </form>
    </div>
  );
}
