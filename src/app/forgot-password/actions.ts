"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { issueToken, isWithinCooldown } from "@/lib/auth/token";
import { sendEmail, appUrl } from "@/lib/email/client";
import { resetPasswordEmail } from "@/lib/email/templates";
import type { AuthFormState } from "@/app/login/actions";

// Identical whether or not the account exists. Anything else turns this form
// into a way to discover which email addresses are registered.
const SENT = "If that email is registered, we've sent a reset link.";

const RequestSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

export async function requestReset(
  _state: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = RequestSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { error: SENT };

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
  });

  if (user && user.role === "OWNER" && user.active && user.email) {
    // Checked before superseding anything: the cooldown reads prior tokens'
    // createdAt, and issueToken marks them consumed.
    if (!(await isWithinCooldown(user.id))) {
      const raw = await issueToken(user.id, "PASSWORD_RESET");
      const { subject, html } = resetPasswordEmail(
        appUrl(`/reset-password/${raw}`),
      );
      // A send failure is logged inside sendEmail and deliberately ignored
      // here: reporting it would confirm the address exists.
      await sendEmail({ to: user.email, subject, html });
    }
  }

  return { error: SENT };
}
