"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth/dal";
import { hashSecret, verifySecret } from "@/lib/auth/password";
import { readSessionToken, deleteOtherSessionsForUser } from "@/lib/auth/session";
import { issueToken } from "@/lib/auth/token";
import { sendEmail, appUrl } from "@/lib/email/client";
import { verifyEmailEmail } from "@/lib/email/templates";
import {
  isLocked,
  lockoutMessage,
  nextLockoutState,
  priorFailures,
} from "@/lib/auth/lockout";

const ChangeSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z.string().min(8, "Use at least 8 characters"),
  })
  .strict();

// A Server Component/Action error thrown in a production build reaches the
// client only as an opaque digest — React redacts the real message. Expected
// failures (wrong password, weak password) are therefore modeled as a return
// value, the same shape login/signup/completeReset already use, not a throw.
export type ChangePasswordState = { error?: string } | undefined;

export async function changePassword(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<ChangePasswordState> {
  const { userId } = await requireOwner();
  const parsed = ChangeSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  if (isLocked(user)) return { error: lockoutMessage(user.lockedUntil!) };

  // A stolen session should not be enough to guess the current password
  // unthrottled: a correct guess is a permanent takeover, since it lets the
  // attacker set a new password and evict the real owner's other sessions.
  // Throttled the same way login throttles a wrong password.
  if (
    !user.passwordHash ||
    !(await verifySecret(user.passwordHash, parsed.data.currentPassword))
  ) {
    const next = nextLockoutState(priorFailures(user));
    await prisma.user.update({ where: { id: userId }, data: next });
    return next.lockedUntil
      ? { error: lockoutMessage(next.lockedUntil) }
      : { error: "Current password is incorrect" };
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: await hashSecret(parsed.data.newPassword),
      failedAttempts: 0,
      lockedUntil: null,
    },
  });

  // Sign out everywhere else, but not the tab doing the changing.
  const current = await readSessionToken();
  if (current) await deleteOtherSessionsForUser(userId, current);

  revalidatePath("/account");
}

export async function resendVerification() {
  const { userId } = await requireOwner();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.email || user.emailVerifiedAt) return;

  const raw = await issueToken(userId, "EMAIL_VERIFICATION");
  const { subject, html } = verifyEmailEmail(appUrl(`/verify-email/${raw}`));
  await sendEmail({ to: user.email, subject, html });
  revalidatePath("/account");
}
