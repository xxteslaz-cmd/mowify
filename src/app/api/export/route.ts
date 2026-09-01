import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth/dal";

/**
 * Hands an owner everything their company has put into GroundsRoute.
 *
 * Terms section 5 and Privacy section 6 both promise this. A Route Handler
 * rather than a Server Action because the deliverable is a file the browser
 * saves, not data returned into a React tree.
 *
 * requireOwner, deliberately not requireActiveOrg. Terms section 3 gives a
 * lapsed company 30 days to "request an export during that window" before its
 * data is deleted — gating this on an active subscription would withhold it
 * from precisely the people the clause was written for.
 *
 * Not in PUBLIC_PREFIXES, so proxy.ts turns away a request with no session
 * cookie before this renders; requireOwner is the real check behind that.
 */
export async function GET(): Promise<Response> {
  const { orgId } = await requireOwner();

  // Every read is scoped by the orgId from the session, never from input —
  // the same rule that governs src/lib/data.ts. An export endpoint that took
  // an org id from the caller would be a tenant-wide data leak with a
  // download button on it.
  const org = await prisma.org.findUniqueOrThrow({
    where: { id: orgId },
    select: {
      name: true,
      slug: true,
      createdAt: true,
      assigneeMode: true,
    },
  });

  const [customers, crews, jobs, people] = await Promise.all([
    prisma.customer.findMany({
      where: { orgId },
      orderBy: { name: "asc" },
    }),
    prisma.crew.findMany({
      where: { orgId },
      orderBy: { name: "asc" },
    }),
    prisma.job.findMany({
      where: { orgId },
      orderBy: { scheduledDate: "asc" },
    }),
    // Names and roles only. Password and PIN hashes are credentials, not
    // customer data, and writing them into a file that lands in a downloads
    // folder would be handing out the company's own logins.
    prisma.user.findMany({
      where: { orgId },
      select: {
        name: true,
        role: true,
        email: true,
        username: true,
        crewId: true,
        active: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const body = JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      company: org,
      people,
      crews,
      customers,
      jobs,
    },
    null,
    2,
  );

  const filename = `groundsroute-${org.slug}-${new Date()
    .toISOString()
    .slice(0, 10)}.json`;

  return new Response(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      // A tenant's entire dataset should not sit in a shared cache anywhere
      // between here and the browser.
      "cache-control": "no-store, private",
    },
  });
}
