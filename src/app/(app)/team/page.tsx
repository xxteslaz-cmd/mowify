import { requireOwner } from "@/lib/auth/dal";
import { prisma } from "@/lib/prisma";
import { getActiveCrews, getAssigneeMode } from "@/lib/data";
import { assigneeTerms } from "@/lib/assignee-terms";
import { isLocked } from "@/lib/auth/lockout";
import TeamClient from "./TeamClient";

export default async function TeamPage() {
  const { orgId } = await requireOwner();

  const [org, members, crews, assigneeMode] = await Promise.all([
    prisma.org.findUniqueOrThrow({
      where: { id: orgId },
      select: { slug: true },
    }),
    prisma.user.findMany({
      where: { orgId, role: "CREW" },
      select: {
        id: true,
        name: true,
        username: true,
        active: true,
        lockedUntil: true,
        crew: { select: { id: true, name: true, color: true } },
      },
      orderBy: { name: "asc" },
    }),
    getActiveCrews(),
    getAssigneeMode(),
  ]);
  const terms = assigneeTerms(assigneeMode);

  // Lockout is resolved here, on the server, into a plain boolean via the same
  // isLocked() the login action uses. Both TeamPage and TeamClient are render
  // functions that react-hooks/purity requires to stay pure, so the Date.now()
  // comparison has to live in a plain helper rather than inline in either.
  const membersWithLockStatus = members.map(({ lockedUntil, ...rest }) => ({
    ...rest,
    locked: isLocked({ lockedUntil }),
  }));

  return (
    <TeamClient
      members={membersWithLockStatus}
      crews={crews}
      terms={terms}
      crewLoginPath={`/c/${org.slug}`}
    />
  );
}
