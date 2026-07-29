"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { consumeToken } from "@/lib/auth/token";
import { hashSecret } from "@/lib/auth/password";
import { deleteAllSessionsForUser } from "@/lib/auth/session";

export type ResetFormState = { error?: string } | undefined;

const EXPIRED = "That link is no longer valid. Request a new one.";

const ResetSchema = z
  .object({
    token: z.string().min(1),
    password: z.string().min(8, "Use at least 8 characters"),
  })
  .strict();

export async function completeReset(
  _state: ResetFormState,
  formData: FormData,
): Promise<ResetFormState> {
  const parsed = ResetSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const claimed = await consumeToken(parsed.data.token, "PASSWORD_RESET");
  if (!claimed) return { error: EXPIRED };

  const passwordHash = await hashSecret(parsed.data.password);

  await prisma.user.update({
    where: { id: claimed.userId },
    // Clearing the lockout is part of recovery: someone who forgot their
    // password has usually locked themselves out guessing at it.
    data: { passwordHash, failedAttempts: 0, lockedUntil: null },
  });

  // If the reset happened because the account was compromised, leaving the
  // attacker's session alive would defeat the whole operation.
  await deleteAllSessionsForUser(claimed.userId);

  redirect("/login?reset=1");
}
