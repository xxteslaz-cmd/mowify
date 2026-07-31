"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/customers", label: "Customers" },
];

export default function MainNav({
  role,
  children,
}: {
  role?: "OWNER" | "CREW" | null;
  children?: React.ReactNode;
}) {
  const pathname = usePathname();
  // Crew can't reach Dashboard or Customers — those routes reject them — so
  // there is nothing useful to link to from their nav.
  const links = role === "OWNER" ? LINKS : [];

  function isActive(href: string) {
    // Detail routes such as /customers/[id] should keep their section lit.
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <>
      {/* Crew work off a phone in the field, so below md the sidebar folds
          back into a plain top bar rather than eating the screen. */}
      <header className="border-b border-border bg-surface md:hidden">
        <nav className="flex items-center gap-6 px-4 py-3">
          <span className="text-lg font-semibold">GroundsRoute</span>
          {links.map(({ href, label }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`text-sm transition ${
                  active
                    ? "font-semibold text-foreground underline decoration-2 underline-offset-8"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {label}
              </Link>
            );
          })}
          <div className="ml-auto flex items-center">{children}</div>
        </nav>
      </header>

      {/* Sticky rather than fixed: it stays put as the content column scrolls,
          but still participates in the body's flex row so it never has to
          fight the main column for width with manual offsets. */}
      <aside className="hidden md:sticky md:top-0 md:flex md:h-screen md:w-60 md:shrink-0 md:flex-col md:border-r md:border-border md:bg-surface">
        <div className="px-5 py-5">
          <span className="text-lg font-semibold">GroundsRoute</span>
        </div>

        <nav className="flex flex-col gap-1 px-3">
          {links.map(({ href, label }) => {
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
                {label}
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
