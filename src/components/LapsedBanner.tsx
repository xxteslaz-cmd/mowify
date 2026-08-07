import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/dal";
import { isOrgActive } from "@/lib/subscription";

/**
 * Shown to owners of a lapsed company on every screen.
 *
 * Crew never see it: they cannot fix it, and their work is deliberately not
 * blocked by it.
 */
export default async function LapsedBanner() {
  const user = await getSessionUser();
  if (!user || user.role !== "OWNER") return null;

  const org = await prisma.org.findUnique({
    where: { id: user.orgId },
    select: { subscriptionStatus: true },
  });

  if (isOrgActive(org?.subscriptionStatus)) return null;

  return (
    <div className="border-b border-danger/30 bg-danger/10 px-4 py-2 text-center text-sm">
      Your account is read-only until billing is sorted out.{" "}
      <Link href="/billing" className="underline underline-offset-4">
        Manage billing
      </Link>
    </div>
  );
}
