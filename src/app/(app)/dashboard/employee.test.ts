import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { makeOrg, makeOwner, makeCrew, makeCrewUser } from "@/test/factories";

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

const { createAssigneeWithLogin } = await import(
  "@/app/(app)/dashboard/actions"
);

async function actAsOwner() {
  const org = await makeOrg(undefined, "EMPLOYEE");
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

beforeEach(() => {
  currentUser.value = null;
});

describe("createAssigneeWithLogin", () => {
  it("creates the person alone when no login is supplied", async () => {
    const org = await actAsOwner();

    const result = await createAssigneeWithLogin({
      name: "Jose",
      color: "#22c55e",
    });

    expect(result).toMatchObject({ ok: true });
    expect(await prisma.crew.count({ where: { orgId: org.id } })).toBe(1);
    expect(
      await prisma.user.count({ where: { orgId: org.id, role: "CREW" } }),
    ).toBe(0);
  });

  it("creates the person and their login together", async () => {
    const org = await actAsOwner();

    const result = await createAssigneeWithLogin({
      name: "Maria",
      color: "#22c55e",
      username: "maria",
      pin: "481920",
    });

    expect(result).toMatchObject({ ok: true });
    const crew = await prisma.crew.findFirstOrThrow({
      where: { orgId: org.id },
    });
    const user = await prisma.user.findFirstOrThrow({
      where: { orgId: org.id, role: "CREW" },
    });
    expect(user.name).toBe("Maria");
    expect(user.username).toBe("maria");
    expect(user.crewId).toBe(crew.id);
    // The PIN must never be recoverable from the row.
    expect(user.pinHash).not.toBe("481920");
    expect(user.pinHash).toMatch(/^\$argon2/);
  });

  it("leaves NO orphaned person behind when the username is taken", async () => {
    const org = await actAsOwner();
    const existingCrew = await makeCrew(org.id);
    await makeCrewUser(org.id, existingCrew.id, "taken");

    const before = await prisma.crew.count({ where: { orgId: org.id } });
    const result = await createAssigneeWithLogin({
      name: "Dan",
      color: "#22c55e",
      username: "taken",
      pin: "481920",
    });

    expect(result).toMatchObject({ ok: false });
    // The whole point of the transaction: a rejected login must not leave a
    // half-made employee the owner then has to find and delete.
    expect(await prisma.crew.count({ where: { orgId: org.id } })).toBe(before);
  });

  it("rejects a PIN that is not six digits, creating nothing", async () => {
    const org = await actAsOwner();

    const result = await createAssigneeWithLogin({
      name: "Dan",
      color: "#22c55e",
      username: "dan",
      pin: "12",
    });

    expect(result).toMatchObject({ ok: false });
    expect(await prisma.crew.count({ where: { orgId: org.id } })).toBe(0);
  });

  it("rejects whitespace-only names", async () => {
    const org = await actAsOwner();

    const result = await createAssigneeWithLogin({
      name: "   ",
      color: "#22c55e",
    });

    expect(result).toMatchObject({ ok: false });
    expect(await prisma.crew.count({ where: { orgId: org.id } })).toBe(0);
  });

  it("refuses a crew member", async () => {
    const org = await makeOrg(undefined, "EMPLOYEE");
    currentUser.value = {
      userId: "x",
      orgId: org.id,
      role: "CREW",
      crewId: null,
      name: "Crew",
    };

    await expect(
      createAssigneeWithLogin({ name: "Jose", color: "#22c55e" }),
    ).rejects.toThrow("redirect: /login");
  });
});
