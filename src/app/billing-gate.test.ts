import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import {
  makeOrg,
  makeOwner,
  makeCrew,
  makeCrewUser,
  makeCustomer,
  makeJob,
} from "@/test/factories";

// Unlike the isolation suites, this one runs the REAL DAL — requireActiveOrg
// is the thing under test, so mocking it away would defeat the point. Only
// the cookie jar and redirect are stubbed, and sessions are real rows.
//
// A partial mock of @/lib/auth/dal would NOT work here: requireActiveOrg calls
// the module's own internal requireOwner, not the exported binding a partial
// mock replaces, so the stub would silently never apply.
const cookieValue = vi.hoisted(() => ({ value: null as string | null }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieValue.value ? { name, value: cookieValue.value } : undefined,
    set: () => {},
    delete: () => {},
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect: ${path}`);
  }),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  // getSessionUser is wrapped in React's cache(). Outside a real request there
  // is no per-request scope to bound that memoisation, so one test's user
  // could leak into the next. Passing cache() through as the identity function
  // keeps every call a fresh read.
  return { ...actual, cache: <T,>(fn: T) => fn };
});

const { createCustomer } = await import("@/app/(app)/customers/actions");
const { createJob, updateJobStatus, createCrew } = await import(
  "@/app/(app)/dashboard/actions"
);
const { createCrewLogin } = await import("@/app/(app)/team/actions");
const { hashToken } = await import("@/lib/auth/session");

async function signIn(userId: string) {
  const raw = randomBytes(32).toString("base64url");
  await prisma.session.create({
    data: {
      tokenHash: hashToken(raw),
      userId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
  cookieValue.value = raw;
}

async function setupOrg(status: string | null) {
  const org = await makeOrg();
  if (status) {
    await prisma.org.update({
      where: { id: org.id },
      data: { subscriptionStatus: status },
    });
  }
  const owner = await makeOwner(org.id);
  return { org, owner };
}

beforeEach(() => {
  cookieValue.value = null;
});

describe("billing gate on owner writes", () => {
  it("allows an owner write when trialing", async () => {
    const { org, owner } = await setupOrg("trialing");
    await signIn(owner.id);

    const customer = await createCustomer({ name: "Ann", address: "1 Elm St" });
    expect(customer.orgId).toBe(org.id);
  });

  it("blocks creating a customer when lapsed", async () => {
    const { org, owner } = await setupOrg("past_due");
    await signIn(owner.id);

    await expect(
      createCustomer({ name: "Ann", address: "1 Elm St" }),
    ).rejects.toThrow("redirect: /billing");
    expect(await prisma.customer.count({ where: { orgId: org.id } })).toBe(0);
  });

  it("blocks creating a crew when lapsed", async () => {
    const { org, owner } = await setupOrg("canceled");
    await signIn(owner.id);

    await expect(
      createCrew({ name: "Blue Team", color: "#22c55e" }),
    ).rejects.toThrow("redirect: /billing");
    expect(await prisma.crew.count({ where: { orgId: org.id } })).toBe(0);
  });

  it("blocks creating a crew login when lapsed", async () => {
    const { org, owner } = await setupOrg("unpaid");
    const crew = await makeCrew(org.id);
    await signIn(owner.id);

    await expect(
      createCrewLogin({ crewId: crew.id, name: "Jose", username: "jose", pin: "481920" }),
    ).rejects.toThrow("redirect: /billing");
  });

  it("blocks creating a job when lapsed", async () => {
    const { org, owner } = await setupOrg("past_due");
    const crew = await makeCrew(org.id);
    const customer = await makeCustomer(org.id);
    await signIn(owner.id);

    await expect(
      createJob({
        customerId: customer.id,
        crewId: crew.id,
        serviceType: "MOW",
        dateISO: "2026-09-01",
        frequency: "ONE_TIME",
      }),
    ).rejects.toThrow("redirect: /billing");
  });

  it("STILL lets a crew member mark a stop complete when the org is lapsed", async () => {
    // The humane half of the design. Blocking this strands people in a yard
    // mid-week to collect from their employer, which is a bad trade even for
    // us. If this test ever fails, the gate has been applied too widely.
    const { org } = await setupOrg("canceled");
    const crew = await makeCrew(org.id);
    const crewUser = await makeCrewUser(org.id, crew.id);
    const customer = await makeCustomer(org.id);
    const job = await makeJob(org.id, crew.id, customer.id, "2026-09-01");

    await signIn(crewUser.id);

    await updateJobStatus(job.id, "COMPLETED");

    const fresh = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(fresh.status).toBe("COMPLETED");
  });
});
