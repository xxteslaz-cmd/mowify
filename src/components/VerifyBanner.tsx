import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/dal";

/**
 * Read in its own component, like UserMenu, so awaiting it does not hold the
 * rest of the page behind it.
 */
export default async function VerifyBanner() {
  const user = await getSessionUser();
  if (!user || user.role !== "OWNER") return null;

  const row = await prisma.user.findUnique({
    where: { id: user.userId },
    select: { emailVerifiedAt: true },
  });
  if (!row || row.emailVerifiedAt) return null;

  return (
    <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-center text-sm">
      Confirm your email so you can recover your account if you forget your
      password.{" "}
      <a href="/account" className="underline underline-offset-4">
        Confirm now
      </a>
    </div>
  );
}
