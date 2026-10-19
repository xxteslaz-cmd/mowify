import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { makeOrg, makeOwner, makeCrew, makeCrewUser } from "@/test/factories";

const currentUser = vi.hoisted(() => ({
  value: null as null | { userId: string; orgId: string; role: "OWNER"; crewId: null; name: string },
}));

vi.mock("@/lib/auth/dal", () => ({
  requireOwner: async () => currentUser.value,
  requireActiveOrg: async () => currentUser.value,
}));
vi.mock("@/lib/auth/session", () => ({
  createSession: vi.fn(),
  deleteAllSessionsForUser: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect: ${to}`);
  },
}));

const { crewLogin } = await import("@/app/c/[slug]/actions");
const { joinCrew } = await import("@/app/c/[slug]/join/[code]/actions");
const { setCrewJoinLink, approveCrewMember, unlockCrewLogin } = await import("@/app/(app)/team/actions");

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const login = (orgId: string, username: string, pin: string) =>
  crewLogin(undefined, form({ orgId, username, pin }));

beforeEach(() => {
  currentUser.value = null;
});

describe("crew PIN lockout", () => {
  it("warns with attempts left, locks on the third miss, and the owner can unlock", async () => {
    const org = await makeOrg();
    const owner = await makeOwner(org.id);
    currentUser.value = { userId: owner.id, orgId: org.id, role: "OWNER", crewId: null, name: "O" };
    const crew = await makeCrew(org.id);
    const user = await makeCrewUser(org.id, crew.id, "jose", "481920");

    expect((await login(org.id, "jose", "000000"))?.error).toMatch(/2 more wrong attempts will lock/);
    expect((await login(org.id, "jose", "000000"))?.error).toMatch(/1 more wrong attempt will lock/);
    expect((await login(org.id, "jose", "000000"))?.error).toMatch(/Too many attempts/);
    // Locked: even the right PIN is refused.
    expect((await login(org.id, "jose", "481920"))?.error).toMatch(/Too many attempts/);

    expect(await unlockCrewLogin(user.id)).toEqual({ ok: true });
    await expect(login(org.id, "jose", "481920")).rejects.toThrow(`redirect: /crew/${crew.id}/today`);
  });
});

describe("crew self-signup", () => {
  it("joins through the link, waits for approval, then signs in", async () => {
    const org = await makeOrg();
    const owner = await makeOwner(org.id);
    currentUser.value = { userId: owner.id, orgId: org.id, role: "OWNER", crewId: null, name: "O" };
    const crew = await makeCrew(org.id);

    expect(await setCrewJoinLink(crew.id, true)).toEqual({ ok: true });
    const { joinCode } = await prisma.crew.findUniqueOrThrow({ where: { id: crew.id } });

    const fields = { code: joinCode!, name: "Ana", username: "Ana", pin: "135790", confirm: "135790" };
    expect(await joinCrew(undefined, form({ ...fields, confirm: "135791" }))).toEqual({
      error: "The two PINs don't match",
    });
    expect(await joinCrew(undefined, form(fields))).toEqual({ done: true });
    expect(await joinCrew(undefined, form(fields))).toEqual({ error: "That username is taken. Try another." });

    // Right PIN, but not approved yet.
    expect((await login(org.id, "ana", "135790"))?.error).toMatch(/hasn't approved/);
    // Wrong PIN on a pending account gives nothing away.
    expect((await login(org.id, "ana", "000000"))?.error).toMatch(/Invalid username or PIN/);

    const ana = await prisma.user.findFirstOrThrow({ where: { orgId: org.id, username: "ana" } });
    expect(await approveCrewMember(ana.id)).toEqual({ ok: true });
    await expect(login(org.id, "ana", "135790")).rejects.toThrow(`redirect: /crew/${crew.id}/today`);
  });

  it("a turned-off link and another company's owner get nowhere", async () => {
    const org = await makeOrg();
    const crew = await makeCrew(org.id);
    await prisma.crew.update({ where: { id: crew.id }, data: { joinCode: "old-code" } });

    const other = await makeOrg();
    const otherOwner = await makeOwner(other.id);
    currentUser.value = { userId: otherOwner.id, orgId: other.id, role: "OWNER", crewId: null, name: "X" };
    expect(await setCrewJoinLink(crew.id, false)).toEqual({ error: "Crew not found." });

    await prisma.crew.update({ where: { id: crew.id }, data: { joinCode: null } });
    const res = await joinCrew(
      undefined,
      form({ code: "old-code", name: "Eve", username: "eve", pin: "111111", confirm: "111111" }),
    );
    expect(res?.error).toMatch(/turned off/);
    expect(await prisma.user.count({ where: { orgId: org.id } })).toBe(0);
  });
});
