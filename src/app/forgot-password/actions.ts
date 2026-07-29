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
  } else {
    // Spends the same number of database round trips as the hit path above
    // (one cooldown-shaped query, two more matching issueToken's supersede-
    // then-create pair) so a miss isn't measurably faster than a hit — the
    // same class of timing oracle DUMMY_HASH closes for password checks in
    // login/actions.ts. These are reads rather than writes on purpose: a
    // write-shaped dummy (updateMany/create) was tried first and measured
    // *slower* than the real hit path on this database, which would just
    // invert the oracle instead of closing it. Reads land close to the real
    // cost without that risk.
    //
    // This narrows the gap rather than closing it: once RESEND_API_KEY is
    // configured, a real hit also pays for an outbound HTTPS call to Resend
    // that no dummy database work can replicate without itself becoming a
    // real send. That residual is accepted rather than chased, because the
    // login form's lockout message already reveals account existence
    // deterministically after five failed attempts — this form isn't
    // introducing a new leak, only failing to fully close an existing one.
    await prisma.token.count({ where: { userId: "no-such-user" } });
    await prisma.token.count({ where: { userId: "no-such-user" } });
    await prisma.token.count({ where: { userId: "no-such-user" } });
  }

  return { error: SENT };
}
