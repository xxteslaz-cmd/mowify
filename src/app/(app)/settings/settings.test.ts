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

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { updateAssigneeMode } = await import("@/app/(app)/settings/actions");

beforeEach(() => {
  currentUser.value = null;
});

async function actAsOwnerOfNewOrg() {
  const org = await makeOrg();
  const owner = await makeOwner(org.id);
  currentUser.value = {
    userId: owner.id,
    orgId: org.id,
    role: "OWNER",
    crewId: null,
    name: "Owner",
  };
  return org;
}

describe("updateAssigneeMode", () => {
  it("defaults a new company to CREW", async () => {
    const org = await makeOrg();
    const fresh = await prisma.org.findUniqueOrThrow({ where: { id: org.id } });
    expect(fresh.assigneeMode).toBe("CREW");
  });

  it("switches to EMPLOYEE", async () => {
    const org = await actAsOwnerOfNewOrg();

    const result = await updateAssigneeMode("EMPLOYEE");

    expect(result).toEqual({ ok: true });
    const fresh = await prisma.org.findUniqueOrThrow({ where: { id: org.id } });
    expect(fresh.assigneeMode).toBe("EMPLOYEE");
  });

  it("switches back to CREW", async () => {
    const org = await actAsOwnerOfNewOrg();
    await updateAssigneeMode("EMPLOYEE");

    await updateAssigneeMode("CREW");

    const fresh = await prisma.org.findUniqueOrThrow({ where: { id: org.id } });
    expect(fresh.assigneeMode).toBe("CREW");
  });

  it("rejects a value outside the enum without writing", async () => {
    const org = await actAsOwnerOfNewOrg();

    const result = await updateAssigneeMode("DROP TABLE" as never);

    expect(result).toHaveProperty("error");
    const fresh = await prisma.org.findUniqueOrThrow({ where: { id: org.id } });
    expect(fresh.assigneeMode).toBe("CREW");
  });

  it("refuses a crew member", async () => {
    const org = await makeOrg();
    currentUser.value = {
      userId: "x",
      orgId: org.id,
      role: "CREW",
      crewId: null,
      name: "Crew",
    };

    await expect(updateAssigneeMode("EMPLOYEE")).rejects.toThrow(
      "redirect: /login",
    );
  });

  it("switching there and back leaves every row untouched", async () => {
    // This is what "non-destructive" means, and asserting it is the only way
    // to know a future change has not started hiding or deleting rows.
    const org = await actAsOwnerOfNewOrg();
    const crew = await makeCrew(org.id);
    const customer = await makeCustomer(org.id);
    const job = await makeJob(org.id, crew.id, customer.id, "2026-09-01");
    const crewUser = await makeCrewUser(org.id, crew.id);

    await updateAssigneeMode("EMPLOYEE");
    await updateAssigneeMode("CREW");

    expect(
      await prisma.crew.findUnique({ where: { id: crew.id } }),
    ).not.toBeNull();
    expect(await prisma.job.findUnique({ where: { id: job.id } })).not.toBeNull();
    expect(
      await prisma.user.findUnique({ where: { id: crewUser.id } }),
    ).not.toBeNull();
    expect(await prisma.crew.count({ where: { orgId: org.id } })).toBe(1);
    expect(await prisma.job.count({ where: { orgId: org.id } })).toBe(1);
  });

  it("never touches another company", async () => {
    const mine = await actAsOwnerOfNewOrg();
    const theirs = await makeOrg();

    await updateAssigneeMode("EMPLOYEE");

    expect(
      (await prisma.org.findUniqueOrThrow({ where: { id: mine.id } }))
        .assigneeMode,
    ).toBe("EMPLOYEE");
    expect(
      (await prisma.org.findUniqueOrThrow({ where: { id: theirs.id } }))
        .assigneeMode,
    ).toBe("CREW");
  });
});
