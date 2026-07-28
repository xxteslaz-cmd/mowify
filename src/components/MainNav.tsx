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

  return (
    <nav className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
      <span className="text-lg font-semibold">Mowify</span>

      {links.map(({ href, label }) => {
        // Detail routes such as /customers/[id] should keep their section lit.
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`text-sm transition ${
              active
                ? "font-semibold text-black underline decoration-2 underline-offset-8 dark:text-white"
                : "text-black/70 hover:text-black dark:text-white/70 dark:hover:text-white"
            }`}
          >
            {label}
          </Link>
        );
      })}

      {children}
    </nav>
  );
}
