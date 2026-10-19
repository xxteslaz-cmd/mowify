import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { makeOrg, makeOwner, makeCrew, makeCustomer, makeJob } from "@/test/factories";
import { isRainy, nextWorkday } from "@/lib/weather";
import { parseISODate, toISODate } from "@/lib/date";

const currentUser = vi.hoisted(() => ({
  value: null as null | { userId: string; orgId: string; role: "OWNER"; crewId: null; name: string },
}));

vi.mock("@/lib/auth/dal", () => ({
  requireOwner: async () => currentUser.value,
  requireActiveOrg: async () => currentUser.value,
  verifySession: async () => currentUser.value,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { pushRainDay } = await import("@/app/(app)/dashboard/actions");

beforeEach(() => {
  currentUser.value = null;
});

describe("rain day", () => {
  it("rain threshold and next working day skip Sunday", () => {
    expect(isRainy(60, 0)).toBe(true);
    expect(isRainy(20, 6)).toBe(true);
    expect(isRainy(40, 1)).toBe(false);
    expect(toISODate(nextWorkday(parseISODate("2026-10-23")))).toBe("2026-10-24"); // Fri → Sat
    expect(toISODate(nextWorkday(parseISODate("2026-10-24")))).toBe("2026-10-26"); // Sat → Mon
  });

  it("moves remaining jobs after the next day's route, leaves done ones and other companies alone", async () => {
    const org = await makeOrg();
    const owner = await makeOwner(org.id);
    currentUser.value = { userId: owner.id, orgId: org.id, role: "OWNER", crewId: null, name: "O" };
    const crew = await makeCrew(org.id);
    const [a, b, c, d] = await Promise.all(["A", "B", "C", "D"].map((n) => makeCustomer(org.id, n)));

    const existing = await makeJob(org.id, crew.id, d.id, "2026-10-24");
    const first = await makeJob(org.id, crew.id, a.id, "2026-10-23");
    const second = await prisma.job.update({
      where: { id: (await makeJob(org.id, crew.id, b.id, "2026-10-23")).id },
      data: { orderInDay: 1 },
    });
    const done = await prisma.job.update({
      where: { id: (await makeJob(org.id, crew.id, c.id, "2026-10-23")).id },
      data: { status: "COMPLETED", orderInDay: 2 },
    });

    const other = await makeOrg();
    const otherCrew = await makeCrew(other.id);
    const otherJob = await makeJob(other.id, otherCrew.id, (await makeCustomer(other.id)).id, "2026-10-23");

    const res = await pushRainDay("2026-10-23");
    expect(res).toEqual({
      toISO: "2026-10-24",
      moved: [
        { customer: "A", crew: crew.name },
        { customer: "B", crew: crew.name },
      ],
    });

    const after = async (id: string) => prisma.job.findUniqueOrThrow({ where: { id } });
    expect(await after(existing.id)).toMatchObject({ orderInDay: 0 });
    expect(await after(first.id)).toMatchObject({ orderInDay: 1, status: "RESCHEDULED" });
    expect(toISODate((await after(second.id)).scheduledDate)).toBe("2026-10-24");
    expect(await after(second.id)).toMatchObject({ orderInDay: 2 });
    expect(toISODate((await after(done.id)).scheduledDate)).toBe("2026-10-23");
    expect(toISODate((await after(otherJob.id)).scheduledDate)).toBe("2026-10-23");
  });

  it("reports when there is nothing to move", async () => {
    const org = await makeOrg();
    currentUser.value = { userId: "x", orgId: org.id, role: "OWNER", crewId: null, name: "O" };
    expect(await pushRainDay("2026-10-23")).toEqual({ error: "Nothing left to move on this day." });
    expect(await pushRainDay("not-a-date")).toEqual({ error: "Invalid date." });
  });
});
