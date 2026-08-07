import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  makeOrg,
  makeOwner,
  makeCrew,
  makeCrewUser,
  makeCustomer,
  makeJob,
} from "@/test/factories";

// Same shape and purpose as src/lib/data.isolation.test.ts's mock: these
// Server Actions call requireOwner()/verifySession() from the DAL, and the
// DAL itself is proven safe by that other suite. Mocking it here lets these
// tests drive the actions as OWNER or CREW without going through real
// cookies/sessions, and isolates what's actually under test — the actions'
// own org-scoping — from the DAL's.
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
  // Mirrors requireOwner: these suites prove org-scoping, and the billing
  // gate is proven separately in src/app/billing-gate.test.ts. Treating every
  // mocked org as paid keeps this suite testing the one thing it is for.
  requireActiveOrg: async () => {
    if (currentUser.value?.role !== "OWNER") throw new Error("redirect: /login");
    return currentUser.value;
  },
  requireCrew: async () => {
    if (currentUser.value?.role !== "CREW") throw new Error("redirect: /login");
    return currentUser.value;
  },
}));

// The actions call these directly (not through the DAL mock above), so they
// need their own stand-ins: revalidatePath has no meaning outside a real
// Next request, and redirect should never be hit by anything these tests
// call — if it is, that's itself a bug worth failing loudly on.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`unexpected redirect: ${path}`);
  }),
}));

const { createCustomer, updateCustomer } = await import("@/app/(app)/customers/actions");
const {
  createJob,
  updateJob,
  createCrew,
  updateCrew,
  deleteCrew,
  moveJobInColumn,
  updateJobStatus,
  bulkRescheduleDay,
  deleteJob,
} = await import("@/app/(app)/dashboard/actions");

const DATE = "2026-08-03";

async function seedOrg(label: string) {
  const org = await makeOrg(`${label} Landscaping`);
  const owner = await makeOwner(org.id);
  const crew = await makeCrew(org.id, `${label} Crew`);
  const customer = await makeCustomer(org.id, `${label} Customer`);
  const job = await makeJob(org.id, crew.id, customer.id, DATE);
  const crewUser = await makeCrewUser(org.id, crew.id);
  return { org, owner, crew, customer, job, crewUser };
}

let a: Awaited<ReturnType<typeof seedOrg>>;
let b: Awaited<ReturnType<typeof seedOrg>>;

beforeEach(async () => {
  a = await seedOrg("Alpha");
  b = await seedOrg("Beta");
  currentUser.value = {
    userId: a.owner.id,
    orgId: a.org.id,
    role: "OWNER",
    crewId: null,
    name: "Alpha Owner",
  };
});

describe("customers/actions.ts cross-org isolation", () => {
  it("updateCustomer cannot rename another org's customer", async () => {
    await updateCustomer(b.customer.id, { name: "Hacked", address: "1 st" });
    const row = await prisma.customer.findUniqueOrThrow({ where: { id: b.customer.id } });
    expect(row.name).toBe(b.customer.name);
    expect(row.address).toBe(b.customer.address);
  });

  // Direct regression test for Finding 1: the reviewer moved a customer
  // between orgs by injecting an `orgId` field into an update body that
  // TypeScript's parameter type doesn't declare but Prisma's generated
  // update-many type still accepts. The zod schema's .strict() must reject
  // the whole request rather than silently drop the extra field.
  it("updateCustomer cannot move a customer to another org via an injected orgId", async () => {
    const forged = { name: "PWNED", address: "1 st", orgId: b.org.id } as unknown as Parameters<
      typeof updateCustomer
    >[1];

    await expect(updateCustomer(a.customer.id, forged)).rejects.toThrow();

    const row = await prisma.customer.findUniqueOrThrow({ where: { id: a.customer.id } });
    expect(row.orgId).toBe(a.org.id);
    expect(row.name).toBe(a.customer.name);
  });

  it("updateCustomer still succeeds for the caller's own customer", async () => {
    await updateCustomer(a.customer.id, { name: "Renamed Co", address: "22 New Rd" });
    const row = await prisma.customer.findUniqueOrThrow({ where: { id: a.customer.id } });
    expect(row.name).toBe("Renamed Co");
    expect(row.address).toBe("22 New Rd");
    expect(row.orgId).toBe(a.org.id);
  });

  // Regression test for the second finding: createCustomer's `data` is built
  // from parsed.data plus a server-derived orgId, but before the .strict()
  // allowlist existed a nested `jobs: { connect: [...] }` reached Prisma's
  // create input untouched. Prisma's UncheckedCreateInput accepts a nested
  // relation write there, so this reparented another company's job onto a
  // brand-new customer row in the attacker's own org — demonstrated over
  // HTTP. The zod schema must refuse the whole request, and org B's job must
  // be provably untouched afterward, not merely "the call threw".
  it("createCustomer cannot reparent another org's job via a nested jobs.connect", async () => {
    const forged = {
      name: "Shell Co",
      address: "1 st",
      jobs: { connect: [{ id: b.job.id }] },
    } as unknown as Parameters<typeof createCustomer>[0];

    await expect(createCustomer(forged)).rejects.toThrow();

    const job = await prisma.job.findUniqueOrThrow({ where: { id: b.job.id } });
    expect(job.orgId).toBe(b.org.id);
    expect(job.customerId).toBe(b.customer.id);

    // No half-created "Shell Co" row should be left behind either — the
    // whole request must be refused, not just the nested connect.
    const shellCo = await prisma.customer.findFirst({ where: { name: "Shell Co" } });
    expect(shellCo).toBeNull();
  });

  // Positive control: a fix that over-tightens createCustomer (e.g. rejecting
  // anything with extra structure, or breaking the happy path while chasing
  // the nested-write hole) would otherwise look identical to a correct fix in
  // every test above.
  it("createCustomer still succeeds for a legitimate new customer", async () => {
    const customer = await createCustomer({ name: "New Co", address: "9 Elm St" });
    const row = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(row.name).toBe("New Co");
    expect(row.orgId).toBe(a.org.id);
  });
});

describe("dashboard/actions.ts cross-org isolation", () => {
  it("updateCrew cannot rename another org's crew", async () => {
    await updateCrew(b.crew.id, { name: "Hacked" });
    const row = await prisma.crew.findUniqueOrThrow({ where: { id: b.crew.id } });
    expect(row.name).toBe(b.crew.name);
  });

  // Regression test for the third finding: same shape as the updateCustomer
  // orgId injection above, but against updateCrew's CrewUpdateInput schema.
  // Before .strict() was added, an injected `orgId` reached
  // Prisma's UncheckedUpdateManyInput and moved the caller's own crew — and
  // everyone/everything scheduled on it — into org B's tenant. Scoped by
  // where:{id, orgId} too, but that only protects *other* orgs' rows; this
  // targets the caller's own crew id, so the where clause alone doesn't stop
  // it and the field-level allowlist is what actually does.
  it("updateCrew cannot move a crew to another org via an injected orgId", async () => {
    const forged = { name: "PWNED", orgId: b.org.id } as unknown as Parameters<
      typeof updateCrew
    >[1];

    await expect(updateCrew(a.crew.id, forged)).rejects.toThrow();

    const row = await prisma.crew.findUniqueOrThrow({ where: { id: a.crew.id } });
    expect(row.orgId).toBe(a.org.id);
    expect(row.name).toBe(a.crew.name);
  });

  // Positive control, same rationale as updateCustomer's: an over-eager fix
  // that rejects any updateCrew call would pass every rejection test above.
  it("updateCrew still succeeds for the caller's own crew", async () => {
    await updateCrew(a.crew.id, { name: "Renamed Crew" });
    const row = await prisma.crew.findUniqueOrThrow({ where: { id: a.crew.id } });
    expect(row.name).toBe("Renamed Crew");
    expect(row.orgId).toBe(a.org.id);
  });

  // Regression test for the fourth finding: createCrew has the same
  // .strict()-allowlist shape as createCustomer. Before it existed, an
  // injected `orgId` reached Prisma's UncheckedCreateInput and created the
  // new crew directly inside org B's tenant instead of the caller's own —
  // planting a foothold in a company the caller doesn't belong to.
  it("createCrew cannot plant a crew in another org via an injected orgId", async () => {
    const forged = { name: "Planted Crew", color: "#ff0000", orgId: b.org.id } as unknown as
      Parameters<typeof createCrew>[0];

    await expect(createCrew(forged)).rejects.toThrow();

    const planted = await prisma.crew.findFirst({ where: { name: "Planted Crew" } });
    expect(planted).toBeNull();
  });

  // Positive control for createCrew, same rationale as above.
  it("createCrew still succeeds for a legitimate new crew", async () => {
    const crew = await createCrew({ name: "New Crew", color: "#0ea5e9" });
    const row = await prisma.crew.findUniqueOrThrow({ where: { id: crew.id } });
    expect(row.name).toBe("New Crew");
    expect(row.orgId).toBe(a.org.id);
  });

  it("deleteCrew cannot delete another org's crew", async () => {
    // A crew with no jobs and no logins in org B, so a successful cross-org
    // delete isn't masked by the job-count or login-count guards — this
    // isolates the org-scoping specifically.
    const bareCrew = await makeCrew(b.org.id, "Beta Bare Crew");
    await deleteCrew(bareCrew.id);
    const row = await prisma.crew.findUnique({ where: { id: bareCrew.id } });
    expect(row).not.toBeNull();
  });

  it("deleteJob cannot delete another org's job", async () => {
    await deleteJob(b.job.id, DATE, b.crew.id);
    const row = await prisma.job.findUnique({ where: { id: b.job.id } });
    expect(row).not.toBeNull();
    expect(row?.id).toBe(b.job.id);
  });

  it("updateJob cannot move another org's job", async () => {
    const before = await prisma.job.findUniqueOrThrow({ where: { id: b.job.id } });

    await expect(
      updateJob({ jobId: b.job.id, dateISO: "2026-08-10", crewId: a.crew.id, scope: "this" }),
    ).rejects.toThrow();

    const after = await prisma.job.findUniqueOrThrow({ where: { id: b.job.id } });
    expect(after.scheduledDate).toEqual(before.scheduledDate);
    expect(after.crewId).toBe(before.crewId);
  });

  it("moveJobInColumn cannot touch another org's job", async () => {
    const before = await prisma.job.findUniqueOrThrow({ where: { id: b.job.id } });

    await expect(moveJobInColumn({ jobId: b.job.id, direction: "up" })).rejects.toThrow();

    const after = await prisma.job.findUniqueOrThrow({ where: { id: b.job.id } });
    expect(after.orderInDay).toBe(before.orderInDay);
  });

  it("bulkRescheduleDay cannot reschedule another org's jobs", async () => {
    const before = await prisma.job.findUniqueOrThrow({ where: { id: b.job.id } });

    await bulkRescheduleDay({ dateISO: DATE, newDateISO: "2026-08-10", jobIds: [b.job.id] });

    const after = await prisma.job.findUniqueOrThrow({ where: { id: b.job.id } });
    expect(after.scheduledDate).toEqual(before.scheduledDate);
    expect(after.status).toBe(before.status);
  });

  it("createJob rejects another org's customerId", async () => {
    const before = await prisma.job.count();

    await expect(
      createJob({
        customerId: b.customer.id,
        serviceType: "MOW",
        frequency: "ONE_TIME",
        dateISO: DATE,
        crewId: a.crew.id,
      }),
    ).rejects.toThrow();

    expect(await prisma.job.count()).toBe(before);
  });

  it("createJob rejects another org's crewId", async () => {
    const before = await prisma.job.count();

    await expect(
      createJob({
        customerId: a.customer.id,
        serviceType: "MOW",
        frequency: "ONE_TIME",
        dateISO: DATE,
        crewId: b.crew.id,
      }),
    ).rejects.toThrow();

    expect(await prisma.job.count()).toBe(before);
  });

  // Regression test for the fifth finding: createJob's newCustomer branch
  // parses through the same NewCustomerInput .strict() schema as
  // createCustomer. Before that schema was applied here, an injected `orgId`
  // on the newCustomer payload reached Prisma's UncheckedCreateInput and
  // created the customer inside org B's tenant instead of the caller's own —
  // the same tenant-planting hole as createCrew, but reachable from the
  // "add job for a brand-new customer" form flow.
  it("createJob rejects a newCustomer payload with an injected orgId", async () => {
    const beforeJobs = await prisma.job.count();
    const forged = {
      name: "Shell Co",
      address: "1 st",
      orgId: b.org.id,
    } as unknown as { name: string; address: string };

    await expect(
      createJob({
        newCustomer: forged,
        serviceType: "MOW",
        frequency: "ONE_TIME",
        dateISO: DATE,
        crewId: a.crew.id,
      }),
    ).rejects.toThrow();

    expect(await prisma.job.count()).toBe(beforeJobs);
    const shellCo = await prisma.customer.findFirst({ where: { name: "Shell Co" } });
    expect(shellCo).toBeNull();
  });

  describe("updateJobStatus", () => {
    it("an owner cannot touch another org's job", async () => {
      await expect(updateJobStatus(b.job.id, "COMPLETED")).rejects.toThrow();
      const row = await prisma.job.findUniqueOrThrow({ where: { id: b.job.id } });
      expect(row.status).toBe("SCHEDULED");
    });

    it("a crew user cannot touch a job on a different crew in their own org", async () => {
      const otherCrew = await makeCrew(a.org.id, "Alpha Second Crew");
      const otherJob = await makeJob(a.org.id, otherCrew.id, a.customer.id, DATE);
      currentUser.value = {
        userId: a.crewUser.id,
        orgId: a.org.id,
        role: "CREW",
        crewId: a.crew.id,
        name: "Alpha Crew",
      };

      await expect(updateJobStatus(otherJob.id, "COMPLETED")).rejects.toThrow();

      const row = await prisma.job.findUniqueOrThrow({ where: { id: otherJob.id } });
      expect(row.status).toBe("SCHEDULED");
    });

    // The positive control: a fix that over-tightens the crew check (e.g.
    // rejecting on orgId+crewId mismatch for the wrong reason) would pass
    // every rejection test above while also breaking this, the one legitimate
    // path a crew member actually needs day to day.
    it("a crew user CAN complete a job on their own crew", async () => {
      currentUser.value = {
        userId: a.crewUser.id,
        orgId: a.org.id,
        role: "CREW",
        crewId: a.crew.id,
        name: "Alpha Crew",
      };

      await updateJobStatus(a.job.id, "COMPLETED");

      const row = await prisma.job.findUniqueOrThrow({ where: { id: a.job.id } });
      expect(row.status).toBe("COMPLETED");
    });
  });
});
