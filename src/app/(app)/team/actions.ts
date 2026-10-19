"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireActiveOrg } from "@/lib/auth/dal";
import { hashSecret } from "@/lib/auth/password";
import { deleteAllSessionsForUser } from "@/lib/auth/session";
import { p2002Fields } from "@/lib/prisma-errors";
import { randomBytes } from "crypto";

const PIN = z.string().regex(/^\d{6}$/, "PIN must be exactly 6 digits");

const CreateSchema = z.object({
  name: z.string().trim().min(1, "Enter a name"),
  username: z
    .string()
    .trim()
    .toLowerCase()
    // Order matters: trim and lowercase run before the checks, or "  AB  "
    // would pass a length check it should fail.
    .min(2, "Username must be at least 2 characters")
    .regex(/^[a-z0-9._-]+$/, "Use letters, numbers, dots, dashes only"),
  pin: PIN,
  crewId: z.string().min(1, "Pick a crew"),
});

export async function createCrewLogin(input: {
  name: string;
  username: string;
  pin: string;
  crewId: string;
}) {
  const { orgId } = await requireActiveOrg();
  const parsed = CreateSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);

  // The crew must belong to this company, or an owner could attach their crew
  // member to another company's crew.
  const crew = await prisma.crew.count({
    where: { id: parsed.data.crewId, orgId },
  });
  if (crew === 0) throw new Error("Pick a crew");

  const taken = await prisma.user.count({
    where: { orgId, username: parsed.data.username },
  });
  if (taken > 0) throw new Error("That username is already in use.");

  try {
    await prisma.user.create({
      data: {
        orgId,
        role: "CREW",
        name: parsed.data.name,
        username: parsed.data.username,
        pinHash: await hashSecret(parsed.data.pin),
        crewId: parsed.data.crewId,
      },
    });
  } catch (err) {
    // The count() above only rules out the common case. Two owners (or two
    // tabs) submitting the same username for this org at the same instant can
    // both pass that check and race to the insert; the loser hits User's
    // unique constraint instead of a friendly error. Only collapse that
    // specific race into the same message users already see from the
    // pre-check — anything else should surface as-is.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002" &&
      p2002Fields(err).includes("username")
    ) {
      throw new Error("That username is already in use.");
    }
    throw err;
  }

  revalidatePath("/team");
}

export async function resetCrewPin(userId: string, pin: string) {
  const { orgId } = await requireActiveOrg();
  const parsed = PIN.safeParse(pin);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);

  const user = await prisma.user.findFirst({
    where: { id: userId, orgId, role: "CREW" },
  });
  if (!user) throw new Error("Crew member not found");

  // Resetting the PIN also clears any lockout, which is how a crew member who
  // locked themselves out gets back in.
  await prisma.user.update({
    where: { id: user.id },
    data: {
      pinHash: await hashSecret(pin),
      failedAttempts: 0,
      lockedUntil: null,
    },
  });

  await deleteAllSessionsForUser(user.id);
  revalidatePath("/team");
}

export async function setCrewLoginActive(userId: string, active: boolean) {
  const { orgId } = await requireActiveOrg();
  const user = await prisma.user.findFirst({
    where: { id: userId, orgId, role: "CREW" },
  });
  if (!user) throw new Error("Crew member not found");

  await prisma.user.update({ where: { id: user.id }, data: { active } });

  // Drop their sessions so a deactivated login stops working immediately
  // rather than whenever the cookie happens to expire.
  if (!active) await deleteAllSessionsForUser(user.id);
  revalidatePath("/team");
}

type TeamResult = { ok: true } | { error: string };

/** Turns a crew's self-signup link on (with a fresh code) or off. */
export async function setCrewJoinLink(crewId: unknown, enabled: unknown): Promise<TeamResult> {
  const { orgId } = await requireActiveOrg();
  if (typeof crewId !== "string" || typeof enabled !== "boolean") return { error: "Invalid request." };
  const { count } = await prisma.crew.updateMany({
    where: { id: crewId, orgId },
    data: { joinCode: enabled ? randomBytes(16).toString("base64url") : null },
  });
  if (count === 0) return { error: "Crew not found." };
  revalidatePath("/team");
  return { ok: true };
}

export async function approveCrewMember(userId: unknown): Promise<TeamResult> {
  const { orgId } = await requireActiveOrg();
  if (typeof userId !== "string") return { error: "Invalid request." };
  const { count } = await prisma.user.updateMany({
    where: { id: userId, orgId, role: "CREW", pendingApproval: true },
    data: { pendingApproval: false, active: true },
  });
  if (count === 0) return { error: "Crew member not found." };
  revalidatePath("/team");
  return { ok: true };
}

/** Deletes a self-signup the owner doesn't recognise. Only ever a pending one. */
export async function rejectCrewMember(userId: unknown): Promise<TeamResult> {
  const { orgId } = await requireActiveOrg();
  if (typeof userId !== "string") return { error: "Invalid request." };
  const { count } = await prisma.user.deleteMany({
    where: { id: userId, orgId, role: "CREW", pendingApproval: true },
  });
  if (count === 0) return { error: "Crew member not found." };
  revalidatePath("/team");
  return { ok: true };
}

export async function unlockCrewLogin(userId: unknown): Promise<TeamResult> {
  const { orgId } = await requireActiveOrg();
  if (typeof userId !== "string") return { error: "Invalid request." };
  const { count } = await prisma.user.updateMany({
    where: { id: userId, orgId, role: "CREW" },
    data: { failedAttempts: 0, lockedUntil: null },
  });
  if (count === 0) return { error: "Crew member not found." };
  revalidatePath("/team");
  return { ok: true };
}
