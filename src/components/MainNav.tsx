"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/customers", label: "Customers" },
];

export default function MainNav({
  role,
  admin = false,
  unanswered = 0,
  children,
}: {
  role?: "OWNER" | "CREW" | null;
  /** A site admin (see src/lib/auth/admin.ts), who also answers FAQ questions. */
  admin?: boolean;
  /** FAQ questions waiting for an answer, shown as a count on that link. */
  unanswered?: number;
  children?: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Crew can't reach Dashboard or Customers — those routes reject them — so
  // there is nothing useful to link to from their nav.
  const links: { href: string; label: string; count?: number }[] =
    role === "OWNER" ? [...LINKS] : [];
  if (role === "OWNER" && admin) {
    links.push({ href: "/admin/questions", label: "FAQ questions", count: unanswered });
  }

  function isActive(href: string) {
    // Detail routes such as /customers/[id] should keep their section lit.
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  // A crew member's bar is just the brand, their name and Sign out, which
  // fits a phone in one row. An owner's has six links plus their name, which
  // does not: rendered inline it ran to almost twice the viewport width and
  // put every owner page on a horizontal scrollbar. So the owner's links
  // collapse behind a Menu button below md instead.
  const collapsible = links.length > 0;

  return (
    <>
      {/* Crew work off a phone in the field, so below md the sidebar folds
          back into a plain top bar rather than eating the screen. */}
      <header className="border-b border-border bg-surface md:hidden">
        <div className="flex items-center gap-6 px-4 py-3">
          <span className="text-lg font-semibold">GroundsRoute</span>
          {collapsible ? (
            <button
              type="button"
              aria-expanded={open}
              aria-controls="mobile-nav"
              onClick={() => setOpen((o) => !o)}
              className="btn btn-ghost ml-auto -my-1"
            >
              {open ? "Close" : "Menu"}
            </button>
          ) : (
            <div className="ml-auto flex items-center">{children}</div>
          )}
        </div>
        {collapsible && (
          <nav
            id="mobile-nav"
            hidden={!open}
            className="flex flex-col gap-1 border-t border-border px-3 py-3"
          >
            {links.map(({ href, label, count }) => {
              const active = isActive(href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  // Client-side navigation keeps this component mounted, so
                  // the panel has to close itself; the links inside
                  // {children} are full page loads and reset it for free.
                  onClick={() => setOpen(false)}
                  className={`rounded-md px-3 py-3 text-sm font-medium transition ${
                    active
                      ? "bg-brand-soft text-brand"
                      : "text-muted hover:bg-foreground/5 hover:text-foreground"
                  }`}
                >
                  <LinkLabel label={label} count={count} />
                </Link>
              );
            })}
            <div className="mt-2 border-t border-border pt-3">{children}</div>
          </nav>
        )}
      </header>

      {/* Sticky rather than fixed: it stays put as the content column scrolls,
          but still participates in the body's flex row so it never has to
          fight the main column for width with manual offsets. */}
      <aside className="hidden md:sticky md:top-0 md:flex md:h-screen md:w-60 md:shrink-0 md:flex-col md:border-r md:border-border md:bg-surface">
        <div className="px-5 py-5">
          <span className="text-lg font-semibold">GroundsRoute</span>
        </div>

        <nav className="flex flex-col gap-1 px-3">
          {links.map(({ href, label, count }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`rounded-md px-3 py-2 text-sm font-medium transition ${
                  active
                    ? "bg-brand-soft text-brand"
                    : "text-muted hover:bg-foreground/5 hover:text-foreground"
                }`}
              >
                <LinkLabel label={label} count={count} />
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto border-t border-border px-3 py-4">
          {children}
        </div>
      </aside>
    </>
  );
}

function LinkLabel({ label, count }: { label: string; count?: number }) {
  return (
    <>
      {label}
      {count ? (
        <span className="ml-2 rounded-full bg-brand px-1.5 py-0.5 text-xs font-semibold text-on-brand">
          {count}
          <span className="sr-only"> waiting</span>
        </span>
      ) : null}
    </>
  );
}
