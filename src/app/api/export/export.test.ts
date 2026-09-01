import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { makeOrg, makeOwner, makeCrew, makeCrewUser, makeCustomer, makeJob } from "@/test/factories";

const currentUser = vi.hoisted(() => ({
  value: null as null | {
    userId: string;
    orgId: string;
    role: "OWNER" | "CREW";
    crewId: string | null;
    name: string;
  },
}));

vi.mock("@/lib/auth/dal", () => ({
  getSessionUser: async () => currentUser.value,
  verifySession: async () => {
    if (!currentUser.value) throw new Error("redirect: /login");
    return currentUser.value;
  },
  requireOwner: async () => {
    if (currentUser.value?.role !== "OWNER") throw new Error("redirect: /login");
    return currentUser.value;
  },
  requireActiveOrg: async () => {
    if (currentUser.value?.role !== "OWNER") throw new Error("redirect: /login");
    return currentUser.value;
  },
}));

const { GET } = await import("@/app/api/export/route");

beforeEach(() => {
  currentUser.value = null;
});

async function seedOrg(customerName: string, status = "active") {
  const org = await makeOrg();
  await prisma.org.update({
    where: { id: org.id },
    data: { subscriptionStatus: status },
  });
  const owner = await makeOwner(org.id, `owner-${org.id}@example.com`);
  const crew = await makeCrew(org.id);
  await makeCrewUser(org.id, crew.id);
  const customer = await makeCustomer(org.id, customerName);
  await makeJob(org.id, crew.id, customer.id);
  return { org, owner };
}

function actAs(orgId: string, userId: string) {
  currentUser.value = {
    userId,
    orgId,
    role: "OWNER",
    crewId: null,
    name: "Owner",
  };
}

describe("the data export", () => {
  it("returns the caller's own company data as a downloadable file", async () => {
    const { org, owner } = await seedOrg("Mrs Hentschel");
    actAs(org.id, owner.id);

    const res = await GET();
    const body = await res.json();

    expect(res.headers.get("content-disposition")).toMatch(/attachment/);
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
    expect(body.customers).toHaveLength(1);
    expect(body.customers[0].name).toBe("Mrs Hentschel");
    expect(body.jobs).toHaveLength(1);
    expect(body.crews).toHaveLength(1);
    expect(body.people).toHaveLength(2);
  });

  it("NEVER includes another company's records", async () => {
    // The test that matters most here. An export endpoint is a whole tenant's
    // data behind one request, so scoping is the entire safety property.
    const mine = await seedOrg("My Customer");
    const theirs = await seedOrg("Their Customer");
    actAs(mine.org.id, mine.owner.id);

    const body = await (await GET()).json();

    const names = body.customers.map((c: { name: string }) => c.name);
    expect(names).toContain("My Customer");
    expect(names).not.toContain("Their Customer");
    expect(body.company.name).toBe(
      (await prisma.org.findUniqueOrThrow({ where: { id: mine.org.id } })).name,
    );
    // And nothing of theirs leaked in through any other collection.
    const otherOrgJobs = await prisma.job.findMany({
      where: { orgId: theirs.org.id },
    });
    const exportedJobIds = body.jobs.map((j: { id: string }) => j.id);
    for (const job of otherOrgJobs) {
      expect(exportedJobIds).not.toContain(job.id);
    }
  });

  it("works for a LAPSED company, which is who needs it most", async () => {
    // Terms section 3 gives a lapsed company 30 days to export before deletion.
    // Gating this on an active subscription would withhold it from exactly the
    // people the clause was written for.
    const { org, owner } = await seedOrg("Still Mine", "canceled");
    actAs(org.id, owner.id);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.customers).toHaveLength(1);
  });

  it("refuses a crew member", async () => {
    const { org } = await seedOrg("Not Yours");
    const crewUser = await prisma.user.findFirstOrThrow({
      where: { orgId: org.id, role: "CREW" },
    });
    currentUser.value = {
      userId: crewUser.id,
      orgId: org.id,
      role: "CREW",
      crewId: crewUser.crewId,
      name: "Crew",
    };

    await expect(GET()).rejects.toThrow(/redirect:/);
  });

  it("refuses a signed-out request", async () => {
    await expect(GET()).rejects.toThrow(/redirect:/);
  });

  it("does not export password or PIN hashes", async () => {
    const { org, owner } = await seedOrg("Someone");
    actAs(org.id, owner.id);

    const raw = await (await GET()).text();

    // Credentials are not customer data, and a file that lands in a downloads
    // folder is the wrong place for the company's own logins.
    expect(raw).not.toMatch(/passwordHash/);
    expect(raw).not.toMatch(/pinHash/);
    expect(raw).not.toMatch(/\$argon2/);
  });
});
