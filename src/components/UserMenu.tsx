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
          {/* Until this existed the only route to /billing was the lapsed
              banner, which by definition appears only once something has gone
              wrong. A customer in good standing had no way to replace an
              expiring card, read an invoice, or cancel without guessing the
              URL — and cancelling is expected to be at least as easy as
              subscribing. */}
          <a
            href="/billing"
            className="text-sm text-muted hover:text-foreground md:rounded-md md:px-3 md:py-1.5 md:hover:bg-foreground/5 md:hover:text-foreground"
          >
            Billing
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
