import { requireOwner } from "@/lib/auth/dal";
import { prisma } from "@/lib/prisma";
import AccountClient from "./AccountClient";

export default async function AccountPage() {
  const { userId } = await requireOwner();
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { email: true, emailVerifiedAt: true, pendingEmail: true },
  });

  return (
    <AccountClient
      email={user.email ?? ""}
      verified={user.emailVerifiedAt !== null}
      pendingEmail={user.pendingEmail}
    />
  );
}
