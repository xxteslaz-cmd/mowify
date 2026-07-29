import { prisma } from "@/lib/prisma";
// Tests import the hashing implementation directly rather than through the
// server-only guard in @/lib/auth/password — that guard exists to catch an
// accidental client import in application code, which isn't a concern here.
import { hashSecret } from "@/lib/auth/hash";
import { slugify } from "@/lib/auth/slug";
import { parseISODate } from "@/lib/date";

let counter = 0;
const unique = () => `${Date.now()}-${counter++}`;

export async function makeOrg(name = `Org ${unique()}`) {
  return prisma.org.create({ data: { name, slug: slugify(name) } });
}

export async function makeOwner(
  orgId: string,
  email = `owner-${unique()}@example.com`,
  password = "owner-password",
) {
  return prisma.user.create({
    data: {
      orgId,
      role: "OWNER",
      name: "Test Owner",
      email,
      passwordHash: await hashSecret(password),
    },
  });
}

export async function makeCrew(orgId: string, name = `Crew ${unique()}`) {
  return prisma.crew.create({ data: { orgId, name, color: "#22c55e" } });
}

export async function makeCrewUser(
  orgId: string,
  crewId: string,
  username = `crew-${unique()}`,
  pin = "481920",
) {
  return prisma.user.create({
    data: {
      orgId,
      role: "CREW",
      name: "Test Crew Member",
      username,
      pinHash: await hashSecret(pin),
      crewId,
    },
  });
}

export async function makeCustomer(orgId: string, name = `Cust ${unique()}`) {
  return prisma.customer.create({
    data: { orgId, name, address: "1 Main St" },
  });
}

export async function makeJob(
  orgId: string,
  crewId: string,
  customerId: string,
  dateISO = "2026-08-03",
) {
  return prisma.job.create({
    data: {
      orgId,
      crewId,
      customerId,
      serviceType: "MOW",
      frequency: "WEEKLY",
      scheduledDate: parseISODate(dateISO),
    },
  });
}
