import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  makeOrg,
  makeOwner,
  makeCrew,
  makeCrewUser,
  makeCustomer,
  makeJob,
} from "@/test/factories";

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

const {
  getJobsForDate,
  getActiveCrews,
  getAllCrews,
  searchCustomers,
  getCustomers,
  getCustomersWithJobCounts,
  getCustomerWithJobs,
  getCrewTodayJobs,
  getDaySummaries,
} = await import("@/lib/data");

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

describe("cross-org isolation", () => {
  it("getJobsForDate returns only this org's jobs", async () => {
    const jobs = await getJobsForDate(DATE);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe(a.job.id);
  });

  it("getActiveCrews returns only this org's crews", async () => {
    const crews = await getActiveCrews();
    expect(crews.map((c) => c.id)).toEqual([a.crew.id]);
  });

  it("getAllCrews returns only this org's crews", async () => {
    const crews = await getAllCrews();
    expect(crews.map((c) => c.id)).toEqual([a.crew.id]);
  });

  it("searchCustomers never returns another org's customers", async () => {
    const all = await searchCustomers("");
    expect(all.map((c) => c.id)).toEqual([a.customer.id]);

    // Searching by the other org's exact customer name must still find nothing.
    const targeted = await searchCustomers("Beta Customer");
    expect(targeted).toHaveLength(0);
  });

  // getCustomers and getCustomersWithJobCounts were added after this brief was
  // written, to fix a real leak: the dashboard and customers pages were
  // rendering every company's customers, not just the signed-in org's. They
  // are covered here for the same reason the rest of this file exists.
  it("getCustomers returns only this org's customers", async () => {
    const customers = await getCustomers();
    expect(customers.map((c) => c.id)).toEqual([a.customer.id]);
  });

  it("getCustomersWithJobCounts returns only this org's customers with correct counts", async () => {
    const customers = await getCustomersWithJobCounts();
    expect(customers.map((c) => c.id)).toEqual([a.customer.id]);
    // The count itself must come from this org's jobs table slice, not the
    // whole table, so it is checked rather than assumed.
    expect(customers[0]._count.jobs).toBe(1);
  });

  it("getCustomerWithJobs returns null for another org's customer id", async () => {
    // A valid id from org B, passed directly. This is the forged-id case.
    expect(await getCustomerWithJobs(b.customer.id)).toBeNull();
    expect(await getCustomerWithJobs(a.customer.id)).not.toBeNull();
  });

  it("getDaySummaries counts only this org's jobs", async () => {
    const summaries = await getDaySummaries([new Date(Date.UTC(2026, 7, 3))]);
    expect(summaries[DATE]?.count).toBe(1);
  });

  it("getCrewTodayJobs returns no crew for another org's crew id", async () => {
    const { crew, jobs } = await getCrewTodayJobs(b.crew.id, DATE);
    expect(crew).toBeNull();
    expect(jobs).toHaveLength(0);
  });

  it("getCrewTodayJobs works for this org's own crew", async () => {
    const { crew, jobs } = await getCrewTodayJobs(a.crew.id, DATE);
    expect(crew?.id).toBe(a.crew.id);
    expect(jobs).toHaveLength(1);
  });
});

describe("crew authorization", () => {
  beforeEach(() => {
    currentUser.value = {
      userId: a.crewUser.id,
      orgId: a.org.id,
      role: "CREW",
      crewId: a.crew.id,
      name: "Alpha Crew",
    };
  });

  it("a crew member can load their own day", async () => {
    const { crew } = await getCrewTodayJobs(a.crew.id, DATE);
    expect(crew?.id).toBe(a.crew.id);
  });

  it("a crew member cannot load another crew's day in their own org", async () => {
    const other = await makeCrew(a.org.id, "Alpha Second Crew");
    const { crew, jobs } = await getCrewTodayJobs(other.id, DATE);
    expect(crew).toBeNull();
    expect(jobs).toHaveLength(0);
  });

  // Every one of these guards requireOwner(), so a CREW session must never
  // reach any of them, however narrow the crew member's own permissions are
  // elsewhere. This is the same owner/customer/job data a rogue crew member
  // would otherwise be able to read straight out of the DAL.
  it("a crew member cannot reach owner-only data", async () => {
    await expect(getJobsForDate(DATE)).rejects.toThrow();
    await expect(getActiveCrews()).rejects.toThrow();
    await expect(getAllCrews()).rejects.toThrow();
    await expect(searchCustomers("")).rejects.toThrow();
    await expect(getCustomers()).rejects.toThrow();
    await expect(getCustomersWithJobCounts()).rejects.toThrow();
    await expect(getCustomerWithJobs(a.customer.id)).rejects.toThrow();
    await expect(getDaySummaries([new Date(Date.UTC(2026, 7, 3))])).rejects.toThrow();
  });
});

describe("signed out", () => {
  beforeEach(() => {
    currentUser.value = null;
  });

  // requireOwner() and verifySession() both redirect when there is no
  // session, so a signed-out caller must be rejected by every data function
  // that touches company data, owner-only or not.
  it("rejects every owner data function", async () => {
    await expect(getJobsForDate(DATE)).rejects.toThrow();
    await expect(getActiveCrews()).rejects.toThrow();
    await expect(getAllCrews()).rejects.toThrow();
    await expect(searchCustomers("")).rejects.toThrow();
    await expect(getCustomers()).rejects.toThrow();
    await expect(getCustomersWithJobCounts()).rejects.toThrow();
    await expect(getCustomerWithJobs(a.customer.id)).rejects.toThrow();
    await expect(getDaySummaries([new Date(Date.UTC(2026, 7, 3))])).rejects.toThrow();
  });

  it("rejects getCrewTodayJobs, which only requires a session, not the owner role", async () => {
    await expect(getCrewTodayJobs(a.crew.id, DATE)).rejects.toThrow();
  });
});
