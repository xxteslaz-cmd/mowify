import "server-only";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifySession, type SessionUser } from "./dal";

/**
 * Whether an address is on the ADMIN_EMAILS allow-list (comma-separated,
 * case-insensitive). Pure so it can be tested without a database.
 *
 * An unset or empty list admits nobody. "No admins configured" must never
 * read as "no check required" — the same fail-closed rule CRON_SECRET follows.
 */
export function isAdminEmail(
  email: string | null | undefined,
  allowList: string | undefined,
): boolean {
  if (!email || !allowList) return false;
  const allowed = allowList
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.trim().toLowerCase());
}

/**
 * The gate on everything under /admin: the people who run GroundsRoute
 * itself, as opposed to the owner of any one company.
 *
 * An admin is an ordinary OWNER account whose email is on ADMIN_EMAILS and
 * has been verified. The verification check is what stops someone signing up
 * with the admin's address before the admin has an account, since signup does
 * not prove ownership of an email until the verify link is clicked.
 *
 * Anyone else gets a 404 rather than a redirect or a 403, so the admin area
 * does not advertise that it exists.
 */
export async function requireSiteAdmin(): Promise<SessionUser> {
  const user = await verifySession();
  if (!(await isSiteAdmin(user))) notFound();
  return user;
}

/**
 * The same test as requireSiteAdmin, without the 404. For deciding whether to
 * show admin links; never use it to guard anything, because a false here
 * lets the caller carry on.
 */
export async function isSiteAdmin(user: SessionUser | null): Promise<boolean> {
  if (user?.role !== "OWNER") return false;

  const row = await prisma.user.findUnique({
    where: { id: user.userId },
    select: { email: true, emailVerifiedAt: true },
  });

  if (!row?.emailVerifiedAt) return false;
  return isAdminEmail(row.email, process.env.ADMIN_EMAILS);
}
