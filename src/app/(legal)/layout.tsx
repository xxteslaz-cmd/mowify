import Link from "next/link";
import { LEGAL } from "@/lib/legal";

/**
 * Shared chrome for /terms and /privacy. These are public pages reached from
 * the landing page and from signup, so they carry their own way back rather
 * than assuming the visitor arrived with browser history to return through.
 */
export default function LegalLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      <Link
        href="/"
        className="text-sm text-muted underline underline-offset-4 hover:text-foreground"
      >
        ← GroundsRoute
      </Link>

      <div className="mt-8">{children}</div>

      <p className="mt-12 border-t border-border pt-6 text-xs text-muted">
        Last updated {LEGAL.lastUpdated}.
      </p>
    </div>
  );
}
