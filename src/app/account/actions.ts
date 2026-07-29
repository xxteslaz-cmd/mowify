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

const ChangeSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z.string().min(8, "Use at least 8 characters"),
  })
  .strict();

export async function changePassword(input: {
  currentPassword: string;
  newPassword: string;
}) {
  const { userId } = await requireOwner();
  const parsed = ChangeSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.passwordHash) throw new Error("Current password is incorrect");

  // Proving you know the current password matters: a stolen session should not
  // be enough to lock the real owner out of their own account.
  if (!(await verifySecret(user.passwordHash, parsed.data.currentPassword))) {
    throw new Error("Current password is incorrect");
  }

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashSecret(parsed.data.newPassword) },
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
