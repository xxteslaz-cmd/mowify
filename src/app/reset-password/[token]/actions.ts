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

  // consumeToken's own compare-and-swap (it stamps consumedAt only while the
  // row is still null) is what makes redemption atomic against a second
  // simultaneous submission of the same link; that guarantee doesn't need
  // re-deriving here.
  const claimed = await consumeToken(parsed.data.token, "PASSWORD_RESET");
  if (!claimed) return { error: EXPIRED };

  const passwordHash = await hashSecret(parsed.data.password);

  // The password write, the lockout clear, and dropping every session happen
  // in one transaction so a crash partway through can never leave the account
  // with a new password but still locked, or with a new password but the
  // attacker's session still alive.
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: claimed.userId },
      // Clearing the lockout is part of recovery: someone who forgot their
      // password has usually locked themselves out guessing at it. Clearing
      // pendingEmail is part of the same recovery: a reset is exactly the
      // "fix the account" step an email-change warning tells a real owner to
      // take, and that advice is worthless if an attacker who already holds a
      // confirmation link can still use it afterwards.
      data: { passwordHash, failedAttempts: 0, lockedUntil: null, pendingEmail: null },
    });

    // Same reasoning as clearing pendingEmail above: burn any outstanding
    // EMAIL_CHANGE token so the link an attacker already holds stops working
    // the moment the owner recovers the account, not just the address it was
    // pointed at.
    await tx.token.updateMany({
      where: { userId: claimed.userId, purpose: "EMAIL_CHANGE", consumedAt: null },
      data: { consumedAt: new Date() },
    });

    // If the reset happened because the account was compromised, leaving the
    // attacker's session alive would defeat the whole operation.
    await deleteAllSessionsForUser(claimed.userId, tx);
  });

  redirect("/login?reset=1");
}
