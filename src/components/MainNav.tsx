"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/customers", label: "Customers" },
];

export default function MainNav() {
  const pathname = usePathname();

  return (
    <nav className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
      <span className="text-lg font-semibold">Mowify</span>

      {LINKS.map(({ href, label }) => {
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
    </nav>
  );
}
