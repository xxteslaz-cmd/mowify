import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { makeOrg, makeOwner, makeCrew } from "@/test/factories";
import { IMPORT_TEMPLATE } from "@/lib/customer-import";

const currentUser = vi.hoisted(() => ({
  value: null as null | { userId: string; orgId: string; role: "OWNER"; crewId: null; name: string },
}));

vi.mock("@/lib/auth/dal", () => ({
  requireOwner: async () => currentUser.value,
  requireActiveOrg: async () => currentUser.value,
  verifySession: async () => currentUser.value,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { importCustomers } = await import("@/app/(app)/customers/actions");
const { generateFirstSchedule } = await import("@/app/(app)/dashboard/actions");

async function actAsOwner() {
  const org = await makeOrg();
  const owner = await makeOwner(org.id);
  currentUser.value = { userId: owner.id, orgId: org.id, role: "OWNER", crewId: null, name: "Owner" };
  return org;
}

beforeEach(() => {
  currentUser.value = null;
});

describe("CSV import → first schedule", () => {
  it("imports the template, then books each customer once on its mow day", async () => {
    const org = await actAsOwner();
    const crew = await makeCrew(org.id);

    expect(await importCustomers(IMPORT_TEMPLATE)).toEqual({ created: 2 });
    const jane = await prisma.customer.findFirstOrThrow({ where: { orgId: org.id, name: "Jane Smith" } });
    expect(jane).toMatchObject({ priceCents: 4500, mowDay: 2, mowFrequency: "WEEKLY" });

    expect(await generateFirstSchedule(crew.id)).toEqual({ created: 2 });
    const first = await prisma.job.findFirstOrThrow({
      where: { customerId: jane.id },
      orderBy: { scheduledDate: "asc" },
    });
    expect(first.scheduledDate.getUTCDay()).toBe(2);
    expect(first).toMatchObject({ serviceType: "MOW", frequency: "WEEKLY", crewId: crew.id });

    // Pressing it again books nothing new.
    expect(await generateFirstSchedule(crew.id)).toHaveProperty("error");
  });

  it("refuses a file with any bad row and creates nothing", async () => {
    const org = await actAsOwner();
    const res = await importCustomers("name,address\nOk,1 A St\n,2 B St\n");
    expect(res).toEqual({ error: "Row 3: missing name" });
    expect(await prisma.customer.count({ where: { orgId: org.id } })).toBe(0);
  });

  it("refuses another company's crew", async () => {
    const other = await makeOrg();
    const foreignCrew = await makeCrew(other.id);
    await actAsOwner();
    await importCustomers(IMPORT_TEMPLATE);
    expect(await generateFirstSchedule(foreignCrew.id)).toEqual({ error: "Pick a crew." });
    expect(await prisma.job.count()).toBe(0);
  });
});
