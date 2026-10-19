"use server";

import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashSecret } from "@/lib/auth/password";
import { p2002Fields } from "@/lib/prisma-errors";

export type JoinState = { error?: string; done?: boolean } | undefined;

const JoinSchema = z
  .object({
    code: z.string().min(1),
    name: z.string().trim().min(1, "Enter your name").max(80),
    // trim/lowercase before the checks, same as createCrewLogin.
    username: z
      .string()
      .trim()
      .toLowerCase()
      .min(2, "Username must be at least 2 characters")
      .max(40)
      .regex(/^[a-z0-9._-]+$/, "Use letters, numbers, dots, dashes only"),
    pin: z.string().regex(/^\d{6}$/, "PIN must be exactly 6 digits"),
    confirm: z.string(),
  })
  .refine((d) => d.pin === d.confirm, { message: "The two PINs don't match", path: ["confirm"] });

/**
 * Self-signup from a crew's join link. Unauthenticated, so the account it
 * makes can do nothing until the owner approves it: active is false and
 * pendingApproval is true, and crew login refuses both.
 */
export async function joinCrew(_state: JoinState, formData: FormData): Promise<JoinState> {
  const parsed = JoinSchema.safeParse({
    code: formData.get("code"),
    name: formData.get("name"),
    username: formData.get("username"),
    pin: formData.get("pin"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const crew = await prisma.crew.findFirst({
    where: { joinCode: parsed.data.code, active: true },
    select: { id: true, orgId: true },
  });
  if (!crew) return { error: "This join link has been turned off. Ask your manager for a new one." };

  try {
    await prisma.user.create({
      data: {
        orgId: crew.orgId,
        crewId: crew.id,
        role: "CREW",
        name: parsed.data.name,
        username: parsed.data.username,
        pinHash: await hashSecret(parsed.data.pin),
        active: false,
        pendingApproval: true,
      },
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002" &&
      p2002Fields(err).includes("username")
    ) {
      return { error: "That username is taken. Try another." };
    }
    throw err;
  }
  return { done: true };
}
